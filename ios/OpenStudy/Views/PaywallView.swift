import SwiftUI

/// The OpenStudy Plus paywall (spec 11.5). Shown when someone creates a project or studies their own
/// material without an active subscription. One price, one button, no countdowns.
struct PaywallView: View {
    var from: String
    /// Runs when the subscription is active (trial started, restored, or already on).
    var onUnlocked: () -> Void
    var onClose: () -> Void

    @EnvironmentObject var store: Store
    @ObservedObject var account = AccountController.shared
    @ObservedObject var shop = StoreService.shared
    @State private var signingIn = false
    @State private var message: String?
    @State private var restoring = false

    static let title = "Keep everything you saved, and learn it."
    static let lines = ["All your projects and lessons", "Your study plan and practice tests", "Smart organize and Ask your notes"]
    /// Terms and Privacy live on the OpenStudy website (the same server that owns accounts).
    static var termsURL: URL? { ServerConfig.base?.appendingPathComponent("terms") }
    static var privacyURL: URL? { ServerConfig.base?.appendingPathComponent("privacy") }

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
                VStack(alignment: .leading, spacing: 22) {
                    Text("OpenStudy Plus").font(Typo.small).foregroundStyle(Palette.blue)
                    Text(Self.title).font(Typo.display).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Self.lines, id: \.self) { line in
                            HStack(spacing: 12) {
                                Image(systemName: "checkmark").font(.system(size: 14, weight: .heavy)).foregroundStyle(Palette.greenText)
                                    .frame(width: 28, height: 28).background(Circle().fill(Palette.greenSoft))
                                Text(line).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                            }
                        }
                    }
                    if unavailable {
                        Text("Subscriptions are not available yet.").font(Typo.bodyBold).foregroundStyle(Palette.muted)
                    } else {
                        Text(shop.priceLine).font(Typo.bodyBold).foregroundStyle(Palette.ink)
                    }
                    if let message { Text(message).font(Typo.small).foregroundStyle(Palette.redText).fixedSize(horizontal: false, vertical: true) }
                    VStack(spacing: 8) {
                        Button(shop.busy && !restoring ? "Starting..." : (shop.trialEligible ? "Start free trial" : "Subscribe")) { Task { await start() } }
                            .buttonStyle(.chunky(.green)).disabled(shop.busy || unavailable)
                        Button(restoring ? "Restoring..." : "Restore purchases") { Task { await restore() } }
                            .buttonStyle(.chunky(.secondary)).disabled(shop.busy || unavailable)
                    }
                    Text("Payment is charged to your Apple ID. It renews monthly unless you cancel at least 24 hours before the period ends, in Settings > Apple ID > Subscriptions.")
                        .font(Typo.tiny).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 16) {
                        if let terms = Self.termsURL { Link("Terms", destination: terms) }
                        if let privacy = Self.privacyURL { Link("Privacy", destination: privacy) }
                    }
                    .font(Typo.small).foregroundStyle(Palette.blue)
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .task {
            store.library.log("paywall_view", ["from": .string(from)])
            await shop.loadProduct()
        }
        .sheet(isPresented: $signingIn) {
            SignInView(onDone: {
                signingIn = false
                Task { await afterSignIn() }
            }, onCancel: { signingIn = false })
        }
    }

    var unavailable: Bool { !account.state.billingOn && !Self.billingOffUnlocked }

    /// Development builds without a configured server unlock everything; release builds say "not yet".
    static var billingOffUnlocked: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    func start() async {
        message = nil
        guard account.state.signedIn, let id = account.state.userId else { signingIn = true; return }
        if account.state.entitlement.active { onUnlocked(); return }
        let wasTrial = shop.trialEligible
        switch await shop.purchase(accountId: id) {
        case .purchased:
            store.library.log(wasTrial ? "trial_start" : "subscribe", ["source": .string("apple")])
            if account.state.entitlement.active { onUnlocked() } else { message = "Your purchase went through. It can take a moment to unlock; try again shortly." }
        case .pending: message = "Your purchase is waiting for approval."
        case .canceled: break
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account. Sign in with that account."
        case .unavailable: message = "The App Store is not available right now."
        case .failed: message = "The purchase did not go through. Try again."
        }
    }

    func restore() async {
        message = nil
        guard account.state.signedIn else { signingIn = true; return }
        restoring = true
        let result = await shop.restore()
        restoring = false
        store.library.log("restore", ["ok": .bool(result == .purchased)])
        switch result {
        case .purchased where account.state.entitlement.active: onUnlocked()
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account. Sign in with that account."
        default: message = "No subscription to restore on this Apple ID."
        }
    }

    func afterSignIn() async {
        await account.reload()
        if account.state.entitlement.active { onUnlocked() }
    }
}
