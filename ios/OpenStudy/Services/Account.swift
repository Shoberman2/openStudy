import Combine
import Foundation

/// The signed-in account and its subscription (spec 11.3 to 11.5). Every screen reads account state
/// through this file. Billing is off when no account server is configured: development builds then
/// unlock everything, release builds show the paywall's "not available yet" state.
struct AccountState: Equatable {
    /// "off": no accounts or payments configured for this app.
    var billingOn: Bool
    var signedIn: Bool
    var userId: String?
    var email: String?
    var entitlement: Entitlement

    static let billingOff = AccountState(billingOn: false, signedIn: false, entitlement: Entitlement(active: true, status: "none"))

    /// Creating projects and studying your own material needs OpenStudy Plus.
    var needsPlus: Bool { billingOn ? !entitlement.active : !PaywallView.billingOffUnlocked }
}

/// Screen-level view of AccountController.shared (the one owner of the session and entitlement).
@MainActor
final class AccountService: ObservableObject {
    @Published private(set) var state: AccountState
    private var sub: AnyCancellable?

    init() {
        state = AccountController.shared.state
        sub = AccountController.shared.$state.receive(on: RunLoop.main).sink { [weak self] in self?.state = $0 }
    }

    func reload() async {
        await AccountController.shared.reload()
    }
}
