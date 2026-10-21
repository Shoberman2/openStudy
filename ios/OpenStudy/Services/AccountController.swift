import Foundation

/// Owns the account session, the server's entitlement answer and its offline cache (spec 11.4,
/// 11.5). One instance for the app; screens read `state` through AccountService.
@MainActor
final class AccountController: ObservableObject {
    static let shared = AccountController()

    @Published private(set) var state: AccountState = .billingOff
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

    // MARK: Sign in (spec 12.1)

    enum Mode { case create, signIn }

    /// What the sign-in screen says for an error.
    static func message(for error: SupabaseAuth.AuthError) -> String {
        switch error {
        case .alreadyExists: return "That email already has an account. Sign in instead."
        case .wrongCredentials, .invalid: return "Wrong email or password."
        case .weakPassword: return "Use at least 8 characters."
        case .rateLimited: return "Too many tries. Wait a minute and try again."
        case .network, .server: return "Could not reach OpenStudy. Check your connection."
        }
    }

    /// Checks the form before it goes to the server. Returns a message, or nil when it can be sent.
    static func check(email: String, password: String) -> String? {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard e.contains("@"), e.contains(".") else { return "Enter your email address." }
        guard password.count >= SupabaseAuth.minPassword else { return "Use at least 8 characters." }
        return nil
    }

    /// Creates the account or signs in. Returns a message to show, or nil when signed in.
    func submit(_ mode: Mode, email: String, password: String) async -> String? {
        if let problem = Self.check(email: email, password: password) { return problem }
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if remote == nil, let server { remote = await ServerConfig.fetch(server) }
        guard let auth else { return "Could not reach OpenStudy. Check your connection." }
        do {
            let s = mode == .create ? try await auth.signUp(email: e, password: password) : try await auth.signIn(email: e, password: password)
            Keychain.session = s
            if mode == .create { welcome(s) }
            await reload()
            return nil
        } catch let error as SupabaseAuth.AuthError {
            return Self.message(for: error)
        } catch {
            return Self.message(for: .server)
        }
    }

    /// `POST /api/welcome`: the server sends the welcome email once. Never blocks sign-up.
    private func welcome(_ s: AuthSession) {
        guard let server else { return }
        var r = URLRequest(url: server.appendingPathComponent("api/welcome"))
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
        Task.detached { _ = try? await URLSession.shared.data(for: r) }
    }

    /// `POST /api/auth/reset`. Returns what to show.
    func resetPassword(email: String) async -> String {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard e.contains("@"), e.contains(".") else { return "Enter your email address first." }
        guard let server else { return "Could not reach OpenStudy. Check your connection." }
        var r = URLRequest(url: server.appendingPathComponent("api/auth/reset"))
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONEncoder().encode(["email": e])
        guard let (_, resp) = try? await URLSession.shared.data(for: r), let http = resp as? HTTPURLResponse else {
            return "Could not reach OpenStudy. Check your connection."
        }
        if http.statusCode == 503 { return "Password reset by email is not set up yet. Write to support." }
        if http.statusCode == 200 { return "If that email has an account, we sent a link to reset the password." }
        return "Could not reach OpenStudy. Check your connection."
    }

    /// The current access token (refreshed when needed), for calls that work signed in or out.
    func accessToken() async -> String? { await validSession()?.accessToken }

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
