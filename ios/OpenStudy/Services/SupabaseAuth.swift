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

/// Supabase Auth over its REST API (spec 12.1): email + password sign-up and sign-in, refresh and
/// sign out. A small direct client instead of supabase-swift: the app needs four endpoints, and
/// this keeps the project free of third-party packages like the rest of it. The project has email
/// confirmation off, so sign-up returns a session at once.
struct SupabaseAuth {
    let url: URL
    let key: String

    enum AuthError: Error, Equatable { case network, rateLimited, invalid, alreadyExists, wrongCredentials, weakPassword, server }

    static let minPassword = 8

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
        throw Self.error(status: code, body: data)
    }

    /// Maps a Supabase Auth error response to what the screen says.
    static func error(status: Int, body: Data) -> AuthError {
        // `code` is a number in some responses and a string in others, so read loosely.
        let b = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        let code = ((b["error_code"] ?? b["code"] ?? b["error"]) as? String ?? "").lowercased()
        let text = ((b["msg"] ?? b["message"] ?? b["error_description"]) as? String ?? "").lowercased()
        if status == 429 || code.contains("rate_limit") { return .rateLimited }
        if code == "user_already_exists" || code == "email_exists" || text.contains("already registered") { return .alreadyExists }
        if code == "invalid_credentials" || code == "invalid_grant" || text.contains("invalid login") { return .wrongCredentials }
        if code == "weak_password" || text.contains("password should") { return .weakPassword }
        if (400..<500).contains(status) { return .invalid }
        return .server
    }

    func signUp(email: String, password: String) async throws -> AuthSession {
        try decodeSession(try await send(request("signup", body: ["email": email, "password": password])))
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        try decodeSession(try await send(request("token", query: [URLQueryItem(name: "grant_type", value: "password")],
                                                  body: ["email": email, "password": password])))
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
}

/// Keychain storage for the session.
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
}
