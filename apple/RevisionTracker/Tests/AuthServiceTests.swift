import Foundation
import XCTest
@testable import RevisionTracker

final class MockAuthHTTPClient: AuthHTTPClient {
    var requests: [URLRequest] = []
    var responses: [(Data, Int)] = []

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let next = responses.isEmpty ? (Data(), 200) : responses.removeFirst()
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: next.1,
            httpVersion: nil,
            headerFields: nil
        )!
        return (next.0, response)
    }
}

final class MemoryAuthSessionStore: AuthSessionStoring {
    var values: [String: String] = [:]

    func get(_ key: String) -> String? { values[key] }
    func set(_ value: String, for key: String) throws { values[key] = value }
    func removeAll() { values.removeAll() }
}

@MainActor
final class AuthServiceTests: XCTestCase {
    private let baseURL = URL(string: "https://project.supabase.co")!

    func testPasswordPolicyMatchesWebRules() {
        XCTAssertNil(PasswordPolicy.validationMessage(for: "StudyNow1!"))
        XCTAssertNotNil(PasswordPolicy.validationMessage(for: "Aa1!"))
        XCTAssertNotNil(PasswordPolicy.validationMessage(for: "STUDYNOW1!"))
        XCTAssertNotNil(PasswordPolicy.validationMessage(for: "studynow1!"))
        XCTAssertNotNil(PasswordPolicy.validationMessage(for: "StudyNow!"))
        XCTAssertNotNil(PasswordPolicy.validationMessage(for: "StudyNow12"))
    }

    func testSignupUsesPasswordMetadataAndDeepLinkRedirect() async throws {
        let http = MockAuthHTTPClient()
        http.responses = [(Data("{}".utf8), 200)]
        let service = AuthService(
            baseURL: baseURL,
            anonKey: "public-key",
            http: http,
            store: MemoryAuthSessionStore()
        )

        await service.signUp(email: " user@example.com ", password: "StudyNow1!", displayName: " Stanley ")

        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.url?.path, "/auth/v1/signup")
        XCTAssertEqual(
            URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "redirect_to" })?.value,
            "revisiontracker://auth/callback"
        )
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]
        )
        XCTAssertEqual(body["email"] as? String, "user@example.com")
        XCTAssertEqual(body["password"] as? String, "StudyNow1!")
        XCTAssertEqual((body["data"] as? [String: Any])?["display_name"] as? String, "Stanley")
    }

    func testPasswordLoginStoresReturnedSessionWithoutEmailEndpoint() async throws {
        let http = MockAuthHTTPClient()
        let response = try JSONSerialization.data(withJSONObject: [
            "access_token": "access",
            "refresh_token": "refresh",
            "user": ["email": "user@example.com"]
        ])
        http.responses = [(response, 200)]
        let store = MemoryAuthSessionStore()
        let service = AuthService(baseURL: baseURL, anonKey: "public-key", http: http, store: store)

        await service.signIn(email: "user@example.com", password: "StudyNow1!")

        XCTAssertEqual(http.requests.first?.url?.path, "/auth/v1/token")
        XCTAssertEqual(
            URLComponents(url: http.requests[0].url!, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "grant_type" })?.value,
            "password"
        )
        XCTAssertEqual(store.values["accessToken"], "access")
        XCTAssertEqual(store.values["refreshToken"], "refresh")
        XCTAssertTrue(service.isSignedIn)
    }

    func testRecoveryRequestUsesRecoverEndpointAndNeutralMessage() async {
        let http = MockAuthHTTPClient()
        http.responses = [(Data(), 200)]
        let service = AuthService(
            baseURL: baseURL,
            anonKey: "public-key",
            http: http,
            store: MemoryAuthSessionStore()
        )

        await service.requestPasswordReset(email: "missing@example.com")

        XCTAssertEqual(http.requests.first?.url?.path, "/auth/v1/recover")
        XCTAssertEqual(
            service.message,
            "If an account exists for that email, password reset instructions are on the way."
        )
    }

    func testRecoveryCallbackPersistsMarkerAndUpdateClearsIt() async {
        let http = MockAuthHTTPClient()
        http.responses = [(Data("{}".utf8), 200)]
        let store = MemoryAuthSessionStore()
        let service = AuthService(baseURL: baseURL, anonKey: "public-key", http: http, store: store)
        let callback = URL(
            string: "revisiontracker://auth/callback#access_token=access&refresh_token=refresh&type=recovery"
        )!

        service.handleCallback(callback)
        XCTAssertTrue(service.isRecoveringPassword)
        XCTAssertTrue(service.isSignedIn)
        XCTAssertEqual(store.values["recoveryPending"], "true")

        await service.updatePassword("ChangedNow2!")

        XCTAssertEqual(http.requests.first?.url?.path, "/auth/v1/user")
        XCTAssertEqual(http.requests.first?.httpMethod, "PUT")
        XCTAssertEqual(http.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer access")
        XCTAssertEqual(store.values["recoveryPending"], "false")
        XCTAssertFalse(service.isRecoveringPassword)
    }

    func testInvalidCallbackDoesNotOverwriteExistingSession() {
        let store = MemoryAuthSessionStore()
        store.values = ["accessToken": "existing", "refreshToken": "existing-refresh"]
        let service = AuthService(
            baseURL: baseURL,
            anonKey: "public-key",
            http: MockAuthHTTPClient(),
            store: store
        )

        service.handleCallback(URL(string: "revisiontracker://auth/callback#error_description=Expired")!)

        XCTAssertEqual(store.values["accessToken"], "existing")
        XCTAssertEqual(service.accessToken, "existing")
    }
}
