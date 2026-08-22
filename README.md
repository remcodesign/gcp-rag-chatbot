# README

## Project Info

| Component | Value |
| ----------- | --------- |
| Project name | Demo RAG Northwind Outfitters |
| Project ID | `rag-demo-no-506313-t5` |
| Region | `europe-west1` (verify Firestore vector-search availability) |
| Backend | Node.js (Cloud Run Service `rag-api`) |
| Frontend | Vue 3 + Vite (static build, served by Cloud Run) |
| Vector store + state | Cloud Firestore (`findNearest`, COSINE) |
| Embeddings + chat | OpenRouter (`openai/text-embedding-3-small` + chosen chat model) |
| IaC | Terraform (`hashicorp/google` + `google-beta`) |
| CI/CD | Cloud Build + Artifact Registry (repo `rag`) |

**Architecture in one line:** one Firestore = vector store + session/event/message state; OpenRouter = embeddings + streaming chat; GCP footprint ≈ €0/mo (all serverless, scales to zero). No Cloud SQL, no VPC connector, no BigQuery.

Full build spec: [`docs/1-1-idea-specs.md`](docs/1-1-idea-specs.md)

<!-- --------------------------------------------------------------- -->
