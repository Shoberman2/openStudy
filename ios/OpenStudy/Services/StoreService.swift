import Combine
import RevenueCat
import StoreKit
import SwiftUI

/// The RevenueCat public SDK key from Secrets.xcconfig. nil while it is the placeholder.
enum RevenueCatConfig {
    static var apiKey: String? {
        guard let k = (Bundle.main.object(forInfoDictionaryKey: "RevenueCatAPIKey") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !k.isEmpty, !k.contains("PLACEHOLDER"), !k.hasPrefix("$(") else { return nil }
        return k
    }
}

/// OpenStudy Plus through the App Store (spec 14): two plans in one subscription group, each with a
/// 7-day free trial. With a RevenueCat key, purchases go through RevenueCat (StoreKit 2 underneath)
/// with the Supabase user id as the app user id and entitlement "pro". Without one, the app uses
/// StoreKit 2 directly, so the local OpenStudy.storekit file works in the simulator. Signed-in
/// StoreKit purchases carry the account id as `appAccountToken` and are recorded on the server.
@MainActor
final class StoreService: ObservableObject {
    static let shared = StoreService()

    @Published private(set) var products: [PlusPlan: Product] = [:]
    @Published private(set) var trialEligible = true
    @Published private(set) var busy = false
    /// Plus from the App Store on this device (RevenueCat "pro", or a current StoreKit entitlement).
    @Published private(set) var hasPro = false

    private var updates: Task<Void, Never>?
    private var accountSub: AnyCancellable?
    private var rcProducts: [String: StoreProduct] = [:]

    var usesRevenueCat: Bool { RevenueCatConfig.apiKey != nil && Purchases.isConfigured }
    /// The monthly product (older call sites).
    var product: Product? { products[.monthly] }

    /// Starts RevenueCat (when a key is set) or the StoreKit listener for renewals, refunds and
    /// purchases made elsewhere. Call once at launch.
    func start() {
        guard updates == nil else { return }
        if let key = RevenueCatConfig.apiKey {
            Purchases.logLevel = .warn
            let builder = Configuration.Builder(withAPIKey: key).with(storeKitVersion: .storeKit2)
            Purchases.configure(with: Keychain.session.map { builder.with(appUserID: $0.userId) }?.build() ?? builder.build())
            updates = Task { [weak self] in
                for await info in Purchases.shared.customerInfoStream {
                    self?.hasPro = info.entitlements[Billing.entitlementId]?.isActive == true
                }
            }
            // Keep RevenueCat's app user id on the Supabase user id.
            accountSub = AccountController.shared.$state.map(\.userId).removeDuplicates().dropFirst().sink { id in
                Task {
                    if let id { _ = try? await Purchases.shared.logIn(id) } else if !Purchases.shared.isAnonymous { _ = try? await Purchases.shared.logOut() }
                }
            }
        } else {
            updates = Task.detached { [weak self] in
                for await result in StoreKit.Transaction.updates {
                    await self?.handle(result)
                }
            }
        }
        Task { await refreshEntitlement() }
    }

    func loadProducts() async {
        if products.count < PlusPlan.allCases.count, let list = try? await Product.products(for: Billing.productIds) {
            var map: [PlusPlan: Product] = [:]
            for p in list { if let plan = PlusPlan.from(productId: p.id) { map[plan] = p } }
            products = map
        }
        if let sub = (products[.yearly] ?? products[.monthly])?.subscription { trialEligible = await sub.isEligibleForIntroOffer }
        if usesRevenueCat, rcProducts.isEmpty {
            for p in await Purchases.shared.products(Billing.productIds) { rcProducts[p.productIdentifier] = p }
        }
    }

    /// Older name, kept for tests and call sites.
    func loadProduct() async { await loadProducts() }

    func price(_ plan: PlusPlan) -> String? { products[plan]?.displayPrice }

    enum PurchaseResult: Equatable { case purchased, pending, canceled, otherAccount, failed, unavailable }

    /// Buys `plan`. `accountId` is the Supabase user id when signed in; nil buys on this Apple ID only
    /// (used when accounts are not set up).
    func purchase(_ plan: PlusPlan = .monthly, accountId: String?) async -> PurchaseResult {
        var token: UUID?
        if let accountId {
            guard let t = UUID(uuidString: accountId) else { return .unavailable }
            token = t
        }
        await loadProducts()
        busy = true
        defer { busy = false }
        if usesRevenueCat {
            guard let p = rcProducts[plan.productId] else { return .unavailable }
            do {
                let r = try await Purchases.shared.purchase(product: p)
                if r.userCancelled { return .canceled }
                hasPro = r.customerInfo.entitlements[Billing.entitlementId]?.isActive == true
                if hasPro { await AccountController.shared.reload() }
                return hasPro ? .purchased : .pending
            } catch {
                return (error as? RevenueCat.ErrorCode) == .purchaseCancelledError ? .canceled : .failed
            }
        }
        guard let product = products[plan] else { return .unavailable }
        do {
            let options: Set<Product.PurchaseOption> = token.map { [.appAccountToken($0)] } ?? []
            switch try await product.purchase(options: options) {
            case .success(let verification):
                return await record(verification, signedIn: token != nil)
            case .pending: return .pending
            case .userCancelled: return .canceled
            @unknown default: return .failed
            }
        } catch {
            return .failed
        }
    }

    /// Older call shape: the monthly plan for a signed-in account.
    func purchase(accountId: String) async -> PurchaseResult { await purchase(.monthly, accountId: Optional(accountId)) }

    /// "Restore purchases": sync with the App Store, then record every current entitlement.
    func restore() async -> PurchaseResult {
        busy = true
        defer { busy = false }
        if usesRevenueCat {
            guard let info = try? await Purchases.shared.restorePurchases() else { return .failed }
            hasPro = info.entitlements[Billing.entitlementId]?.isActive == true
            if hasPro { await AccountController.shared.reload() }
            return hasPro ? .purchased : .failed
        }
        try? await AppStore.sync()
        var result: PurchaseResult = .failed
        let signedIn = AccountController.shared.state.signedIn
        for await v in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let tx) = v, Billing.productIds.contains(tx.productID) else { continue }
            result = await record(v, signedIn: signedIn)
        }
        return result
    }

    /// Reads what this Apple ID already owns (launch, foreground).
    func refreshEntitlement() async {
        if usesRevenueCat {
            if let info = try? await Purchases.shared.customerInfo() { hasPro = info.entitlements[Billing.entitlementId]?.isActive == true }
            return
        }
        var owned = false
        for await v in StoreKit.Transaction.currentEntitlements {
            if case .verified(let tx) = v, Billing.productIds.contains(tx.productID), tx.revocationDate == nil { owned = true }
        }
        hasPro = owned
    }

    private func record(_ verification: StoreKit.VerificationResult<StoreKit.Transaction>, signedIn: Bool) async -> PurchaseResult {
        guard case .verified(let tx) = verification else { return .failed }
        hasPro = true
        guard signedIn else {
            await tx.finish()
            return .purchased
        }
        let outcome = await AccountController.shared.record(jws: verification.jwsRepresentation)
        // Finish only once the server has it, so an offline purchase is retried via Transaction.updates.
        if outcome != .failed { await tx.finish() }
        switch outcome {
        case .ok: return .purchased
        case .otherAccount: return .otherAccount
        case .failed: return .failed
        }
    }

    private func handle(_ verification: StoreKit.VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let tx) = verification, Billing.productIds.contains(tx.productID) else { return }
        guard AccountController.shared.state.signedIn else {
            await tx.finish()
            await refreshEntitlement()
            return
        }
        _ = await record(verification, signedIn: true)
    }

    func manageSubscriptions() async {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        try? await AppStore.showManageSubscriptions(in: scene)
    }

    /// "7 days free, then $59.99 a year." with the store's localized price when it has loaded.
    func priceLine(_ plan: PlusPlan) -> String {
        PlusGate.priceLine(plan: plan, price: price(plan), trial: trialEligible)
    }

    /// Older call sites: the monthly line.
    var priceLine: String { priceLine(.monthly) }

    /// "Save 37%" for the yearly plan once both prices are known.
    var yearlySaving: Int? {
        guard let m = products[.monthly]?.price, let y = products[.yearly]?.price else {
            return PlusGate.yearlySaving(monthly: 7.99, yearly: 59.99)
        }
        return PlusGate.yearlySaving(monthly: m, yearly: y)
    }
}
