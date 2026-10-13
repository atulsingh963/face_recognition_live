# Security and Privacy Policy

## 1. Principles
- **Fail Closed**: In any ambiguous, erroneous, or anomalous situation, deny access.
- **Local Drop**: Failed liveness attempts on Android are never transmitted to backend inference.
- **Zero Raw Biometric Logging**: Never log images, crops, embeddings, tokens, or session secrets.
- **Consent & Purpose Limitation**: Biometric processing strictly occurs for authorized access verification.
- **Revocation**: Deletion of a user deactivates both relational records and FAISS vector index embeddings immediately.

## 2. Retention Policy
- Camera frames on device: Kept only in RAM for the active challenge, immediately discarded after challenge finish or failure.
- Inference payload: In-memory evaluation only. No disk persistence of inference crops.
- Templates: Embeddings stored only for actively enrolled individuals who provided valid consent.
