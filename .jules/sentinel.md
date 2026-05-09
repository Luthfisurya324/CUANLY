## 2024-05-09 - Missing Expiration Time for Magic Links
**Vulnerability:** Magic links generated via the `/web` command (`web_token`) did not have an expiration time, allowing a user's dashboard link to be valid indefinitely. This increases the risk of session hijacking if the link is ever leaked or intercepted.
**Learning:** In systems providing magic link access, tokens must inherently expire after a short time window. Storing the token indefinitely compromises security and violates the principle of least privilege.
**Prevention:** Implement token expiration properties in the database schema (e.g. `web_token_expires_at`) alongside the token string, and rigorously verify that the token hasn't expired on every authentication attempt.
