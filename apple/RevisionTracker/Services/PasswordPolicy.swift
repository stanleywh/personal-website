import Foundation

enum PasswordPolicy {
    static let minimumLength = 8
    static let supportedSymbols = CharacterSet(charactersIn: "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./")

    static func validationMessage(for password: String) -> String? {
        if password.count < minimumLength { return "Use at least 8 characters." }
        if password.rangeOfCharacter(from: .lowercaseLetters) == nil { return "Add a lowercase letter." }
        if password.rangeOfCharacter(from: .uppercaseLetters) == nil { return "Add an uppercase letter." }
        if password.rangeOfCharacter(from: .decimalDigits) == nil { return "Add a number." }
        if password.rangeOfCharacter(from: supportedSymbols) == nil { return "Add a symbol." }
        return nil
    }
}
