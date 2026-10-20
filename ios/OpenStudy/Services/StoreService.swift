import StoreKit
import SwiftUI

/// OpenStudy Plus through the App Store (spec 11.5): StoreKit 2, one auto-renewable product with a
/// 7-day free trial. Every purchase carries the account id as `appAccountToken`, and every verified
/// transaction is recorded on the server so the web app unlocks too.
@MainActor
final class StoreService: ObservableObject {
    static let shared = StoreService()

    @Published private(set) var product: Product?
    @Published private(set) var trialEligible = true
    @Published private(set) var busy = false
    private var updates: Task<Void, Never>?

    /// Starts listening for renewals, refunds and purchases made outside the app (Ask to Buy, offer
    /// codes, another device). Call once at launch.
    func start() {
        guard updates == nil else { return }
        updates = Task.detached { [weak self] in
            for await result in StoreKit.Transaction.updates {
                await self?.handle(result)
            }
        }
    }

    func loadProduct() async {
        guard product == nil else { return }
        product = try? await Product.products(for: [Billing.productId]).first
        if let sub = product?.subscription { trialEligible = await sub.isEligibleForIntroOffer }
    }

    enum PurchaseResult: Equatable { case purchased, pending, canceled, otherAccount, failed, unavailable }

    func purchase(accountId: String) async -> PurchaseResult {
        await loadProduct()
        guard let product, let token = UUID(uuidString: accountId) else { return .unavailable }
        busy = true
        defer { busy = false }
        do {
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case .success(let verification):
                return await record(verification)
            case .pending: return .pending
            case .userCancelled: return .canceled
            @unknown default: return .failed
            }
        } catch {
            return .failed
        }
    }

    /// "Restore purchases": sync with the App Store, then record every current entitlement.
    func restore() async -> PurchaseResult {
        busy = true
        defer { busy = false }
        try? await AppStore.sync()
        var result: PurchaseResult = .failed
        for await v in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let tx) = v, tx.productID == Billing.productId else { continue }
            result = await record(v)
        }
        return result
    }

    private func record(_ verification: VerificationResult<StoreKit.Transaction>) async -> PurchaseResult {
        guard case .verified(let tx) = verification else { return .failed }
        let outcome = await AccountController.shared.record(jws: verification.jwsRepresentation)
        // Finish only once the server has it, so an offline purchase is retried via Transaction.updates.
        if outcome != .failed { await tx.finish() }
        switch outcome {
        case .ok: return .purchased
        case .otherAccount: return .otherAccount
        case .failed: return .failed
        }
    }

    private func handle(_ verification: VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let tx) = verification, tx.productID == Billing.productId else { return }
        guard AccountController.shared.state.signedIn else { return }
        _ = await record(verification)
    }

    func manageSubscriptions() async {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else { return }
        try? await AppStore.showManageSubscriptions(in: scene)
    }

    /// "7 days free, then $10 a month." with the store's localized price when it has loaded.
    var priceLine: String {
        let price = product?.displayPrice ?? "$10"
        return trialEligible ? "7 days free, then \(price) a month. Cancel anytime." : "\(price) a month. Cancel anytime."
    }
}
