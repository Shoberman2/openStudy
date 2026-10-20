import Foundation

/// Owns the account session, the server's entitlement answer and its offline cache (spec 11.4,
/// 11.5). One instance for the app; screens read `state` through AccountService.
@MainActor
final class AccountController: ObservableObject {
    static let shared = AccountController()

    @Published private(set) var state: AccountState = .billingOff
    /// The email a sign-in link or code was sent to, while we wait for it.
    @Published var pendingEmail: String?
    @Published private(set) var loaded = false

    private var remote: ServerConfig.Remote?
    private let cacheKey = "entitlementCache"

    var server: URL? { ServerConfig.base }
    private var auth: SupabaseAuth? {
        guard let r = remote, r.billing, let u = r.supabaseUrl.flatMap(URL.init(string:)), let k = r.supabaseKey else { return nil }
        return SupabaseAuth(url: u, key: k)
    }

    // MARK: Loading

    func reload() async {
        defer { loaded = true }
        guard let server else { state = .billingOff; return }
        if remote == nil { remote = await ServerConfig.fetch(server) }
        guard let remote else {
            // Server unreachable: use the cached answer for a signed-in user.
            if let s = Keychain.session {
                state = AccountState(billingOn: true, signedIn: true, userId: s.userId, email: s.email,
                                     entitlement: Billing.offline(cached, userId: s.userId) ?? Self.none)
            } else { state = .billingOff }
            return
        }
        guard remote.billing else { state = .billingOff; return }
        guard let session = await validSession() else {
            state = AccountState(billingOn: true, signedIn: false, entitlement: Self.none)
            return
        }
        state = await fetchMe(session)
    }

    static let none = Entitlement(active: false, status: "none")

    private func validSession() async -> AuthSession? {
        guard var s = Keychain.session else { return nil }
        if s.expiresAt.timeIntervalSinceNow < 120, let auth {
            do {
                s = try await auth.refresh(s)
                Keychain.session = s
            } catch SupabaseAuth.AuthError.invalid {
                Keychain.session = nil
                return nil
            } catch {
                return s // offline: keep it, the server call below falls back to the cache
            }
        }
        return s
    }

    private var cached: Billing.Cached? {
        get { UserDefaults.standard.data(forKey: cacheKey).flatMap { try? JSONDecoder().decode(Billing.Cached.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: cacheKey) }
    }

    private func fetchMe(_ s: AuthSession) async -> AccountState {
        struct Me: Decodable { struct U: Decodable { var id: String; var email: String? }; var user: U; var entitlement: Billing.WireEntitlement }
        let offline = AccountState(billingOn: true, signedIn: true, userId: s.userId, email: s.email,
                                   entitlement: Billing.offline(cached, userId: s.userId) ?? Self.none)
        guard let server else { return offline }
        var r = URLRequest(url: server.appendingPathComponent("api/me"))
        r.timeoutInterval = 15
        r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: r), let http = resp as? HTTPURLResponse else { return offline }
        if http.statusCode == 401 {
            Keychain.session = nil
            cached = nil
            return AccountState(billingOn: true, signedIn: false, entitlement: Self.none)
        }
        guard http.statusCode == 200, let me = try? JSONDecoder().decode(Me.self, from: data) else { return offline }
        cached = Billing.Cached(entitlement: me.entitlement, userId: me.user.id, fetchedAt: ISO.now())
        return AccountState(billingOn: true, signedIn: true, userId: me.user.id, email: me.user.email ?? s.email, entitlement: me.entitlement.entitlement)
    }

    // MARK: Sign in

    /// Sends the sign-in email. Returns a message to show, or nil when it was sent.
    func sendSignIn(email: String) async -> String? {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard e.contains("@"), e.contains(".") else { return "Enter your email address." }
        if remote == nil, let server { remote = await ServerConfig.fetch(server) }
        guard let auth else { return "Accounts are not available right now. Try again later." }
        do {
            Keychain.pendingVerifier = try await auth.sendSignInEmail(e)
            pendingEmail = e
            return nil
        } catch SupabaseAuth.AuthError.rateLimited {
            return "Too many emails. Wait a minute and try again."
        } catch {
            return "We could not send the email. Check the address and your connection."
        }
    }

    func verify(code: String) async -> String? {
        guard let auth, let email = pendingEmail else { return "Ask for a new email first." }
        do {
            Keychain.session = try await auth.verifyCode(email: email, code: code.filter(\.isNumber))
            pendingEmail = nil
            await reload()
            return nil
        } catch {
            return "That code did not work. Check it, or open the link in the email."
        }
    }

    /// Handles `openstudy://auth-callback?code=...`. Returns true when the URL was a sign-in link.
    func handle(url: URL) async -> Bool {
        guard let code = SupabaseAuth.callbackCode(url) else { return false }
        if remote == nil, let server { remote = await ServerConfig.fetch(server) }
        guard let auth, let verifier = Keychain.pendingVerifier else { return true }
        if let s = try? await auth.exchange(code: code, verifier: verifier) {
            Keychain.session = s
            Keychain.pendingVerifier = nil
            pendingEmail = nil
        }
        await reload()
        return true
    }

    func signOut() async {
        if let s = Keychain.session { await auth?.signOut(s) }
        Keychain.session = nil
        cached = nil
        state = AccountState(billingOn: state.billingOn, signedIn: false, entitlement: Self.none)
    }

    /// Deletes the server account (the library on this iPhone stays). App Store subscriptions must be
    /// canceled in Settings; the caller says so before asking.
    func deleteAccount() async -> Bool {
        guard let server, let s = await validSession() else { return false }
        var r = URLRequest(url: server.appendingPathComponent("api/me"))
        r.httpMethod = "DELETE"
        r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (_, resp) = try? await URLSession.shared.data(for: r), (resp as? HTTPURLResponse)?.statusCode == 200 else { return false }
        Keychain.session = nil
        cached = nil
        state = AccountState(billingOn: true, signedIn: false, entitlement: Self.none)
        return true
    }

    // MARK: App Store

    enum TransactionResult: Equatable { case ok, otherAccount, failed }

    /// Sends a verified-on-device StoreKit transaction to the server, which verifies it again with
    /// Apple's certificates and records it on this account.
    func record(jws: String) async -> TransactionResult {
        guard let server, let s = await validSession() else { return .failed }
        var r = URLRequest(url: server.appendingPathComponent("api/apple/transaction"))
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONEncoder().encode(["jws": jws])
        guard let (_, resp) = try? await URLSession.shared.data(for: r), let http = resp as? HTTPURLResponse else { return .failed }
        if http.statusCode == 409 { return .otherAccount }
        guard http.statusCode == 200 else { return .failed }
        state = await fetchMe(s)
        return .ok
    }
}
