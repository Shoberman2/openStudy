import CryptoKit
import Foundation
import Security

/// The OpenStudy server that owns accounts and billing (spec 11.4). Set by the `OPENSTUDY_SERVER`
/// build setting (Info.plist `OpenStudyServer`); empty means accounts and billing are off.
enum ServerConfig {
    static var base: URL? {
        #if DEBUG
        // UI tests pass -noAccountServer so a local web server on :3000 never turns the paywall on.
        if ProcessInfo.processInfo.arguments.contains("-noAccountServer") { return nil }
        #endif
        guard var s = (Bundle.main.object(forInfoDictionaryKey: "OpenStudyServer") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        while s.hasSuffix("/") { s.removeLast() }
        return URL(string: s)
    }

    /// `GET /api/config`: the Supabase project and publishable key (safe to ship; RLS guards data).
    struct Remote: Decodable, Equatable {
        var billing: Bool
        var supabaseUrl: String?
        var supabaseKey: String?
        var appleProductId: String?
    }

    static func fetch(_ base: URL) async -> Remote? {
        var r = URLRequest(url: base.appendingPathComponent("api/config"))
        r.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: r),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(Remote.self, from: data)
    }
}

/// A signed-in Supabase session. Stored in the Keychain, never in the library file.
struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String?
}

/// Supabase Auth over its REST API (spec 11.4): email sign-in link (PKCE) and the 6-digit code,
/// refresh and sign out. A small direct client instead of supabase-swift: the app needs five
/// endpoints, and this keeps the project free of third-party packages like the rest of it.
/// Apple sign-in can be added later as one more grant (`id_token`) on the same token endpoint.
struct SupabaseAuth {
    let url: URL
    let key: String
    static let redirect = "openstudy://auth-callback"

    enum AuthError: Error, Equatable { case network, rateLimited, invalid, server }

    private func request(_ path: String, query: [URLQueryItem] = [], body: [String: Any]?, token: String? = nil) -> URLRequest {
        var c = URLComponents(url: url.appendingPathComponent("auth/v1/" + path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query }
        var r = URLRequest(url: c.url!)
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue(key, forHTTPHeaderField: "apikey")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { r.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        return r
    }

    private func send(_ r: URLRequest) async throws -> Data {
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: r) } catch { throw AuthError.network }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(code) { return data }
        if code == 429 { throw AuthError.rateLimited }
        if (400..<500).contains(code) { throw AuthError.invalid }
        throw AuthError.server
    }

    /// Sends the sign-in email. Returns the PKCE verifier to keep until the link comes back.
    func sendSignInEmail(_ email: String) async throws -> String {
        let verifier = Self.randomVerifier()
        let challenge = Self.challenge(for: verifier)
        _ = try await send(request("otp", query: [URLQueryItem(name: "redirect_to", value: Self.redirect)], body: [
            "email": email, "create_user": true, "code_challenge": challenge, "code_challenge_method": "s256",
        ]))
        return verifier
    }

    func verifyCode(email: String, code: String) async throws -> AuthSession {
        try decodeSession(try await send(request("verify", body: ["type": "email", "email": email, "token": code])))
    }

    /// Finishes the sign-in link: `openstudy://auth-callback?code=...`.
    func exchange(code: String, verifier: String) async throws -> AuthSession {
        try decodeSession(try await send(request("token", query: [URLQueryItem(name: "grant_type", value: "pkce")],
                                                  body: ["auth_code": code, "code_verifier": verifier])))
    }

    func refresh(_ s: AuthSession) async throws -> AuthSession {
        try decodeSession(try await send(request("token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                                                  body: ["refresh_token": s.refreshToken])))
    }

    func signOut(_ s: AuthSession) async {
        _ = try? await send(request("logout", body: nil, token: s.accessToken))
    }

    private func decodeSession(_ data: Data) throws -> AuthSession {
        struct User: Decodable { var id: String; var email: String? }
        struct Token: Decodable { var access_token: String; var refresh_token: String; var expires_in: Double; var user: User }
        guard let t = try? JSONDecoder().decode(Token.self, from: data) else { throw AuthError.server }
        return AuthSession(accessToken: t.access_token, refreshToken: t.refresh_token,
                           expiresAt: Date().addingTimeInterval(t.expires_in), userId: t.user.id, email: t.user.email)
    }

    static func randomVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 48)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The `code` from a sign-in link, if this URL is one.
    static func callbackCode(_ url: URL) -> String? {
        guard url.scheme == "openstudy", url.host == "auth-callback",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        return items.first(where: { $0.name == "code" })?.value
    }
}

/// Keychain storage for the session and the pending PKCE verifier.
enum Keychain {
    private static let service = "com.openstudy.shelf.auth"

    static func set(_ data: Data?, for account: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        guard let data else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ account: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static var session: AuthSession? {
        get { get("session").flatMap { try? JSONDecoder().decode(AuthSession.self, from: $0) } }
        set { set(newValue.flatMap { try? JSONEncoder().encode($0) }, for: "session") }
    }

    static var pendingVerifier: String? {
        get { get("pkce").flatMap { String(data: $0, encoding: .utf8) } }
        set { set(newValue.map { Data($0.utf8) }, for: "pkce") }
    }
}
