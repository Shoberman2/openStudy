import SwiftUI

/// The OpenStudy Plus paywall (spec 14.4). Opens when a free limit is reached or from the profile,
/// never at launch. Shows price, period, trial terms, auto-renew terms, Terms and Privacy, and
/// Restore Purchases, as App Review requires. No countdowns, no fake urgency.
struct PaywallView: View {
    var from: String
    /// Runs when Plus is active (trial started, restored, or already on).
    var onUnlocked: () -> Void
    var onClose: () -> Void

    @EnvironmentObject var store: Store
    @ObservedObject var account = AccountController.shared
    @ObservedObject var shop = StoreService.shared
    @State private var plan: PlusPlan = .yearly
    @State private var signingIn = false
    @State private var message: String?
    @State private var restoring = false
    @State private var success = 0

    static let title = "Study Everything You Save"
    static let lines = ["Unlimited study sets and quizzes", "The full study check, with export", "Your shelf backed up and moved between devices"]

    static let site = URL(string: "https://openstudy-psi.vercel.app")!
    static var termsURL: URL { (ServerConfig.base ?? site).appendingPathComponent("terms") }
    static var privacyURL: URL { (ServerConfig.base ?? site).appendingPathComponent("privacy") }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                IconButton(systemName: "xmark", label: "Close") {
                    store.library.log("paywall_close")
                    onClose()
                }
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 12) {
                        OwlView(mood: .happy, size: 72)
                        Text(Self.title)
                            .font(Typo.display).tracking(Typo.tracking(for: 32))
                            .foregroundStyle(Palette.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        if let reason = PlusGate.reason(from) {
                            Text(reason).font(Typo.body).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Self.lines, id: \.self) { line in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                Text(line).font(Typo.body).foregroundStyle(Palette.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(spacing: 10) {
                        ForEach(PlusPlan.allCases) { p in planRow(p) }
                    }

                    VStack(spacing: 10) {
                        Text(shop.priceLine(plan) + " Cancel anytime.")
                            .font(Typo.bodyBold).foregroundStyle(Palette.ink)
                            .multilineTextAlignment(.center)
                        if let message {
                            Text(message).font(Typo.small).foregroundStyle(Palette.bad).multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Button(shop.busy && !restoring ? "One moment..." : (shop.trialEligible ? "Start free trial" : "Subscribe")) { Task { await start() } }
                            .buttonStyle(.pill).disabled(shop.busy)
                        Button(restoring ? "Restoring..." : "Restore Purchases") { Task { await restore() } }
                            .buttonStyle(TextLinkStyle(color: Palette.ink2)).disabled(shop.busy)
                    }

                    Text(renewalTerms)
                        .font(Typo.small).foregroundStyle(Palette.ink3)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 28) {
                        Link("Terms", destination: Self.termsURL)
                        Link("Privacy", destination: Self.privacyURL)
                    }
                    .font(Typo.smallBold).foregroundStyle(Palette.ink)
                    .frame(minHeight: 44)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .background(Palette.bg.ignoresSafeArea())
        .sensoryFeedback(.success, trigger: success)
        .task {
            store.library.log("paywall_view", ["from": .string(from)])
            await shop.loadProducts()
        }
        .sheet(isPresented: $signingIn) {
            SignInView(onDone: {
                signingIn = false
                Task { await afterSignIn() }
            }, onCancel: { signingIn = false })
        }
    }

    func planRow(_ p: PlusPlan) -> some View {
        let price = shop.price(p) ?? p.fallbackPrice
        return Button { plan = p } label: {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(p.title).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                    Text(p == .yearly ? "\(price) a year" + (shop.yearlySaving.map { ", save \($0)%" } ?? "") : "\(price) a month")
                        .font(Typo.small).foregroundStyle(Palette.ink2)
                }
                Spacer()
                Image(systemName: plan == p ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(plan == p ? Palette.ink : Palette.lineStrong)
            }
        }
        .buttonStyle(TileStyle(state: plan == p ? .selected : .normal, minHeight: 64))
        .accessibilityAddTraits(plan == p ? .isSelected : [])
    }

    var renewalTerms: String {
        let price = shop.price(plan) ?? plan.fallbackPrice
        let trial = shop.trialEligible ? "The 7-day free trial starts today. " : ""
        return "\(trial)Payment is charged to your Apple ID at the end of the trial. OpenStudy Plus renews automatically at \(price) a \(plan.period) unless you cancel at least 24 hours before the current period ends. Manage or cancel in Settings > Apple ID > Subscriptions."
    }

    func start() async {
        message = nil
        if store.plusActive { onUnlocked(); return }
        // With accounts set up, buy on the account so the web unlocks too; otherwise on this Apple ID.
        var accountId: String?
        if account.state.billingOn {
            guard account.state.signedIn, let id = account.state.userId else { signingIn = true; return }
            accountId = id
        }
        let wasTrial = shop.trialEligible
        switch await shop.purchase(plan, accountId: accountId) {
        case .purchased:
            store.library.log(wasTrial ? "trial_start" : "subscribe", ["source": .string("apple"), "kind": .string(plan.rawValue)])
            unlocked()
        case .pending: message = "Your purchase is waiting for approval."
        case .canceled: break
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account. Sign in with that account."
        case .unavailable: message = "The App Store is not available right now."
        case .failed:
            if shop.hasPro { unlocked() } else { message = "The purchase did not go through. Try again." }
        }
    }

    func restore() async {
        message = nil
        restoring = true
        let result = await shop.restore()
        restoring = false
        store.library.log("restore", ["ok": .bool(result == .purchased)])
        switch result {
        case .purchased: unlocked()
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account. Sign in with that account."
        default: message = "No subscription to restore on this Apple ID."
        }
    }

    func unlocked() {
        success += 1
        store.toast = "OpenStudy Plus is on"
        onUnlocked()
    }

    func afterSignIn() async {
        await account.reload()
        if store.plusActive { unlocked() }
    }
}
