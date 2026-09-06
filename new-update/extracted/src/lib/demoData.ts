import type { Task, TaskListItem } from '../types';

export const INITIAL_DEMO_TASKS: Task[] = [
  {
    id: 'task-demo-1',
    prompt: 'Compare modern vector database architectures (pgvector vs Pinecone vs Qdrant) for high-concurrency production applications in 2026',
    status: 'completed',
    current_step: 'Completed',
    model_used: 'anthropic/claude-3.7-sonnet',
    steps_used: 7,
    searches_used: 12,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    completed_at: new Date(Date.now() - 3600000 * 1.9).toISOString(),
    plan: {
      goal: 'Evaluate latency, cost per 1M vectors, index build time, and hybrid search support for pgvector, Pinecone, and Qdrant.',
      steps: [
        'Query recent benchmarks for HNSW index performance in pgvector 0.7+',
        'Analyze Pinecone serverless tier pricing and cold-start latencies',
        'Inspect Qdrant Rust-based payload filtering and distributed clustering capabilities',
        'Synthesize findings into architectural trade-off matrix with recommendations'
      ]
    },
    sources: [
      {
        title: 'Benchmarking Vector Databases in 2026: Latency and Recall at Scale',
        url: 'https://benchmark.vectordb.org/2026-comparison-pgvector-pinecone-qdrant',
        snippet: 'At 10 million 1536-dim embeddings, Qdrant achieves 14ms p99 latency with filtered searches, while pgvector with HNSW on managed RDS shows 21ms p99 with unified relational joins.'
      },
      {
        title: 'PostgreSQL pgvector Optimization Guide for High QPS Workloads',
        url: 'https://supabase.com/blog/pgvector-performance-hnsw-tuning-2026',
        snippet: 'Iterative improvements in pgvector make it the default choice when vectors coexist with transactional schemas, eliminating cross-service sync overhead.'
      },
      {
        title: 'Pinecone Serverless Architecture Deep-Dive & Economics',
        url: 'https://docs.pinecone.io/guides/architecture/serverless-indexing',
        snippet: 'Decoupled compute and storage allows burstable query patterns without paying for idle memory capacity, making it attractive for fluctuating workloads.'
      },
      {
        title: 'Qdrant Distributed Deployments: Payload Filtering and High Availability',
        url: 'https://qdrant.tech/articles/distributed-payload-filtering-deep-dive',
        snippet: 'Native Rust implementation delivers the highest queries-per-second per dollar when multi-tenant metadata filtering is heavily utilized.'
      }
    ],
    result: `## Executive Summary & Architectural Evaluation

When selecting a vector storage and retrieval engine in 2026, the core architectural decision hinges on **operational complexity vs. native relational cohesion**:

### 1. pgvector (PostgreSQL Extension)
- **Best For:** Teams already running PostgreSQL wanting zero architectural overhead and ACID transactional guarantees across vectors and entity tables.
- **Strengths:** Eliminates dual-write consistency problems. Joins between vectors and structured tables execute in a single SQL query.
- **Trade-offs:** Demands careful RAM sizing (index must fit in shared buffers). Re-indexing large collections (>20M vectors) can produce storage bloat if autovacuum is not tuned.

### 2. Qdrant (Dedicated Engine in Rust)
- **Best For:** High-throughput systems with complex, nested metadata payload filtering.
- **Strengths:** Industry-leading P99 latency under heavy concurrent filter loads. Native cluster replication with raft consensus.
- **Trade-offs:** Requires running and operating an independent stateful service or paying for Qdrant Cloud.

### 3. Pinecone (Fully Managed Serverless)
- **Best For:** Teams prioritizing zero infrastructure maintenance and elastic burst capacity.
- **Strengths:** True serverless pricing model where compute scales down to zero when idle.
- **Trade-offs:** Vendor lock-in; cannot run on-premises or in self-hosted VPC without Enterprise tiers.

### Recommended Decision Matrix
| Requirement | Recommended Choice | Primary Justification |
| :--- | :--- | :--- |
| Relational join density | **pgvector** | Unified database engine; no synchronization pipeline |
| High QPS with rich filtering | **Qdrant** | Optimized Rust segment indexing with memory mapping |
| Serverless elasticity | **Pinecone** | Decoupled storage & automated scaling |

---

### Agent verification

- Verified: yes
- Reason: Verified against 4 independent benchmark reports and official 2026 release specifications. All 3 engines were compared across identical criteria.`,
    error: null
  },
  {
    id: 'task-demo-2',
    prompt: 'Investigate EU Artificial Intelligence Act compliance deadlines and enforcement mechanisms for generative AI foundation models',
    status: 'completed',
    current_step: 'Completed',
    model_used: 'openai/gpt-4o',
    steps_used: 5,
    searches_used: 8,
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    completed_at: new Date(Date.now() - 3600000 * 7.8).toISOString(),
    plan: {
      goal: 'Identify binding milestones, copyright transparency requirements, systemic risk thresholds, and fines under the EU AI Act.',
      steps: [
        'Retrieve European AI Office implementation timetable for General Purpose AI (GPAI)',
        'Extract systemic risk criteria (10^25 FLOPs computing threshold)',
        'Synthesize governance obligations and non-compliance penalty structure'
      ]
    },
    sources: [
      {
        title: 'European Commission: EU AI Act Timeline & Implementation Guidance',
        url: 'https://digital-strategy.ec.europa.eu/en/policies/ai-act-implementation-timeline',
        snippet: 'Prohibited practices took effect after 6 months; General Purpose AI rules apply after 12 months, with full high-risk system obligations phasing in.'
      },
      {
        title: 'Compliance Handbook for Foundation Model Providers under EU Law',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689',
        snippet: 'Providers of GPAI models with systemic risks must conduct model evaluations, adversarial testing, track incidents, and ensure cybersecurity protections.'
      }
    ],
    result: `## EU AI Act: Key Milestones & Foundation Model Obligations

The European Union Artificial Intelligence Act (Regulation EU 2024/1689) establishes a tiered risk-based enforcement regime:

### Critical Deadlines
1. **February 2025:** Absolute prohibition on unacceptable risk systems (e.g. social scoring, untargeted facial scraping).
2. **August 2025:** General Purpose AI (GPAI) governance framework enters into full effect, requiring model technical documentation and copyright compliance summaries.
3. **August 2026:** Comprehensive rules for High-Risk AI systems listed in Annex III take effect.
4. **August 2027:** Obligations for high-risk AI systems that are safety components of regulated products.

### Obligations for GPAI & Foundation Models
- **Standard GPAI:** Must maintain up-to-date technical documentation, provide summary of training content, and respect copyright opt-outs.
- **Systemic Risk GPAI (>10²⁵ FLOPs):** Additional mandates including continuous adversarial red-teaming, documented incident logging, and European AI Office audits.

---

### Agent verification

- Verified: yes
- Reason: Cited from official EU regulation text (Regulation 2024/1689) and European Commission digital policy guides.`,
    error: null
  },
  {
    id: 'task-demo-3',
    prompt: 'Analyze latest solid-state battery energy density breakthroughs from Toyota, QuantumScape, and CATL',
    status: 'analyzing',
    current_step: 'Synthesizing findings from lab disclosures and patent filings',
    model_used: 'meta-llama/llama-3.3-70b-instruct',
    steps_used: 4,
    searches_used: 6,
    created_at: new Date(Date.now() - 120000).toISOString(),
    completed_at: null,
    plan: {
      goal: 'Compare commercialization timelines and Wh/kg volumetric densities across leading solid-state battery developers.',
      steps: [
        'Search QuantumScape QSE-5 anode-free lithium-metal test results',
        'Examine CATL all-solid-state battery 2027 pilot production roadmap',
        'Review Toyota sulfide-based solid electrolyte durability data',
        'Synthesize manufacturing yield hurdles and estimated commercial rollouts'
      ]
    },
    sources: [
      {
        title: 'QuantumScape Begins Low-Volume B-Sample Deliveries for Automotive Testing',
        url: 'https://ir.quantumscape.com/news/news-details/2025/battery-milestone-b-samples',
        snippet: 'Anode-free lithium-metal platform demonstrates over 800 Wh/L volumetric energy density and fast-charging capability.'
      },
      {
        title: 'CATL Outlines 2027 Solid-State Roadmap with High-Nickel Cathodes',
        url: 'https://catl.com/en/news/solid-state-breakthrough-energy-density',
        snippet: 'CATL target specs exceed 450 Wh/kg gravimetric density, targeting luxury EV applications by 2027.'
      }
    ],
    result: null,
    error: null
  }
];

export function toTaskListItem(task: Task): TaskListItem {
  return {
    id: task.id,
    prompt: task.prompt,
    status: task.status,
    current_step: task.current_step,
    steps_used: task.steps_used,
    searches_used: task.searches_used,
    model_used: task.model_used,
    created_at: task.created_at,
    completed_at: task.completed_at
  };
}
