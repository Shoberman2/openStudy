import SwiftUI

/// Sign in by email (spec 11.4): we email a sign-in link that opens the app, and the 6-digit code
/// in the email works too. `onDone` runs once the account is signed in.
struct SignInView: View {
    @ObservedObject var account = AccountController.shared
    var onDone: () -> Void
    var onCancel: () -> Void
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var message: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                IconButton(systemName: "xmark", label: "Close", action: onCancel)
                Spacer()
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let sentTo = account.pendingEmail {
                        Text("Check your email").font(Typo.title).foregroundStyle(Palette.ink)
                        Text("We sent a sign-in link to \(sentTo). Open it on this iPhone. If the email has a 6-digit code, type it here instead.")
                            .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                        field("Code", text: $code, placeholder: "123456", keyboard: .numberPad, content: .oneTimeCode)
                        messageView
                        Button(busy ? "Checking..." : "Sign in with code") { Task { await verify() } }
                            .buttonStyle(.chunky).disabled(busy || code.filter(\.isNumber).count < 6)
                        Button("Send the email again") { Task { await send(sentTo) } }.buttonStyle(.chunky(.secondary)).disabled(busy)
                        Button("Use a different email") { account.pendingEmail = nil; code = ""; message = nil }
                            .font(Typo.bodyBold).foregroundStyle(Palette.blue).frame(maxWidth: .infinity)
                    } else {
                        Text("Sign in or create your account").font(Typo.title).foregroundStyle(Palette.ink)
                        Text("Your account holds your subscription. Your notes and lessons stay on this iPhone.")
                            .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                        field("Email", text: $email, placeholder: "you@example.com", keyboard: .emailAddress, content: .emailAddress)
                            .onSubmit { Task { await send(email) } }
                        messageView
                        Button(busy ? "Sending..." : "Email me a sign-in link") { Task { await send(email) } }
                            .buttonStyle(.chunky).disabled(busy)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.paper.ignoresSafeArea())
        .onAppear { focused = true }
        .onChange(of: account.state.signedIn) { _, signedIn in if signedIn { onDone() } }
    }

    @ViewBuilder var messageView: some View {
        if let message { Text(message).font(Typo.small).foregroundStyle(Palette.redText).fixedSize(horizontal: false, vertical: true) }
    }

    func field(_ label: String, text: Binding<String>, placeholder: String, keyboard: UIKeyboardType, content: UITextContentType) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: label)
            TextField(placeholder, text: text)
                .font(Typo.bodyBold)
                .keyboardType(keyboard)
                .textContentType(content)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.shelf))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
        }
    }

    func send(_ address: String) async {
        busy = true
        message = await account.sendSignIn(email: address)
        busy = false
    }

    func verify() async {
        busy = true
        message = await account.verify(code: code)
        busy = false
        if message == nil, account.state.signedIn { onDone() }
    }
}
