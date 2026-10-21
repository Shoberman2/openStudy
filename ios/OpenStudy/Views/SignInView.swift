import SwiftUI

/// Email and password (spec 12.1): create an account or sign in, with no codes or emails to wait
/// for. `onDone` runs once signed in.
struct SignInView: View {
    @ObservedObject var account = AccountController.shared
    @EnvironmentObject var store: Store
    var onDone: () -> Void
    var onCancel: () -> Void
    @State private var mode: AccountController.Mode = .create
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var message: String?
    @State private var notice: String?
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                IconButton(systemName: "xmark", label: "Close", action: onCancel)
                Spacer()
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(mode == .create ? "Create your account" : "Sign in").font(Typo.title).foregroundStyle(Palette.ink)
                    Text("Your account holds your subscription. Your notes and lessons stay on this iPhone.")
                        .font(Typo.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    field("Email") {
                        TextField("you@example.com", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .focused($focus, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focus = .password }
                    }
                    field("Password") {
                        SecureField(mode == .create ? "At least 8 characters" : "Your password", text: $password)
                            .textContentType(mode == .create ? .newPassword : .password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { Task { await submit() } }
                    }
                    if let message {
                        Text(message).font(Typo.small).foregroundStyle(Palette.redText).fixedSize(horizontal: false, vertical: true)
                    }
                    if let notice {
                        Text(notice).font(Typo.small).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    Button(busy ? "One moment..." : mode == .create ? "Create account" : "Sign in") { Task { await submit() } }
                        .buttonStyle(.chunky).disabled(busy)
                    Button(mode == .create ? "I already have an account" : "I need an account") {
                        mode = mode == .create ? .signIn : .create
                        message = nil; notice = nil
                    }
                    .font(Typo.bodyBold).foregroundStyle(Palette.blue).frame(maxWidth: .infinity)
                    if mode == .signIn {
                        Button("Forgot password?") { Task { await reset() } }
                            .font(Typo.bodyBold).foregroundStyle(Palette.muted).frame(maxWidth: .infinity).disabled(busy)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.paper.ignoresSafeArea())
        .onAppear { focus = .email }
        .onChange(of: account.state.signedIn) { _, signedIn in if signedIn { onDone() } }
    }

    func field(_ label: String, @ViewBuilder input: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: label)
            input()
                .font(Typo.bodyBold)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.shelf))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
        }
    }

    func submit() async {
        busy = true; notice = nil
        let m = mode
        message = await account.submit(m, email: email, password: password)
        busy = false
        guard message == nil else { return }
        if m == .signIn { store.library.log("sign_in", [:]) }
        if account.state.signedIn { onDone() }
    }

    func reset() async {
        busy = true; message = nil
        notice = await account.resetPassword(email: email)
        busy = false
    }
}
