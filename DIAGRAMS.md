# dsh-righthand — diagrams

Rendered with Mermaid. View in any markdown preview that supports Mermaid (GitHub, VS Code with extension, Obsidian, etc.).

## 1. Tool-building workflow

```mermaid
flowchart TD
    U["User asks: build me a reusable tool that ..."] --> DSH["DSH Agent (dsh-righthand)"]

    subgraph G["1. GUIDANCE"]
        direction TB
        G1["load skill: righthand-primitive-selection"]
        G2["cf_advise -> toolsmith Agent<br/>(ambiguous / account-specific)"]
    end
    DSH --> G1
    G1 --> G2

    subgraph A["2. AUTHOR (two modes)"]
        direction TB
        A1["Mode A - cf_define<br/>agent writes entryCode"]
        A2["Mode B - cf_draft<br/>toolsmith proposes spec"]
    end
    G1 --> A1
    G2 --> A2

    subgraph V["3. VALIDATE (local, no deploy)"]
        V1["syntax / schema / manifest / exported class"]
    end
    A1 --> V1
    A2 --> V1

    subgraph T["4. PRE-TEST (optional)"]
        T1["Sandbox SDK runCode()<br/>@cloudflare/sandbox"]
    end
    V1 -->|"status: draft / proposed"| T1

    subgraph DP["5. DEPLOY (approval-gated)"]
        direction TB
        DP1["ask human approval<br/>(tools/pre-execute)"]
        DP2["Cloudflare API SDK<br/>upload + bindings + migrations"]
        DP3["background job (ctx.jobs)"]
    end
    T1 --> DP1
    DP1 -->|"approve"| DP2
    DP2 --> DP3

    subgraph I["6. INVOKE + TEST"]
        direction TB
        I1["cf_invoke"]
        I2["cf_describe (logs / tail)"]
    end
    DP3 -->|"status: deployed<br/>invokeTarget + version"| I1
    I1 --> I2

    subgraph IT["7. ITERATE"]
        direction TB
        IT1["cf_revise / cf_edit"]
        IT2["cf_fork -> new version"]
    end
    I2 -->|"fail"| IT1
    IT1 --> V1
    IT2 --> V1

    subgraph R["8. RELEASE + REUSE"]
        direction TB
        R1["cf_promote (tag: stable)"]
        R2["reuse from any workspace / device<br/>(registry sync: D1 + Artifacts)"]
    end
    I2 -->|"pass"| R1
    R1 --> R2

    DOC["TOOL.md - regenerated at every step"]
    V1 -.-> DOC
    DP2 -.-> DOC
    I1 -.-> DOC
    IT1 -.-> DOC
    IT2 -.-> DOC
    R1 -.-> DOC
```

## 2. Sharing tools with other users (future)

```mermaid
flowchart LR
    OWNER["Owner<br/>Cloudflare account A"]
    REG["Registry Worker (control plane)<br/>D1: tools + grants + quotas<br/>Artifacts: source/history<br/>R2: logs"]
    TOOL["Tool (Worker / DO / Agent)<br/>invokeTarget"]
    GUEST["Guest<br/>Cloudflare account B"]
    HUB["Righthand Hub (future)<br/>Workers + D1 + better-auth<br/>browse / request / manage grants"]

    OWNER -->|"cf_share(tool, guest, scope, quota)"| REG
    REG -->|"grant: read / invoke / fork / co-own<br/>+ per-grantee quota (owner pays)"| REG
    GUEST -->|"1. invoke (registry-proxied)"| REG
    REG -->|"2. check ACL + quota"| REG
    REG -->|"3. forward / deny"| TOOL
    TOOL -->|"result"| GUEST
    GUEST -->|"cf_list_shared / cf_accept / cf_fork"| REG
    GUEST -->|"browse + request access"| HUB
    HUB -->|"reads same registry (D1 + Artifacts)"| REG
    OWNER -->|"manage grants + quotas"| HUB
```

## Legend

- **Solid arrows** = the agent's ordered workflow / control flow.
- **Dashed arrows** = side effects (documentation updates).
- The **TOOL.md** node shows that every step synchronously regenerates the tool's self-documentation (see RESEARCH.md §20).
- In the sharing diagram, all invocation is **registry-proxied** in v1 so ACL + per-grantee quota checks happen at a single choke point (see RESEARCH.md §22).
