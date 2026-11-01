import AuthenticationServices
import CryptoKit
import SwiftUI

/// Apple's own button (required styling), shaped as a pill to match every other button.
struct AppleSignInButton: View {
    var onDone: (String?) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var nonce = ""
    @State private var busy = false

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            nonce = Self.randomNonce()
            request.requestedScopes = [.email]
            request.nonce = Self.sha256(nonce)
        } onCompletion: { result in
            switch result {
            case .success(let auth):
                guard let cred = auth.credential as? ASAuthorizationAppleIDCredential,
                      let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
                    onDone("Sign in with Apple did not finish. Try again."); return
                }
                busy = true
                Task {
                    let message = await AccountController.shared.signInWithApple(idToken: token, nonce: nonce)
                    busy = false
                    onDone(message)
                }
            case .failure(let error):
                if (error as? ASAuthorizationError)?.code == .canceled { return }
                onDone("Sign in with Apple did not finish. Try again.")
            }
        }
        .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
        .frame(height: 52)
        .clipShape(Capsule())
        .opacity(busy ? 0.6 : 1)
        .disabled(busy)
        .sensoryFeedback(.impact(weight: .light), trigger: busy)
    }

    static func randomNonce(length: Int = 32) -> String {
        let chars = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var rng = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in chars[Int(rng.next() % UInt64(chars.count))] })
    }

    static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
