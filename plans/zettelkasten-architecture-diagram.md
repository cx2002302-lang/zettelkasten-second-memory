# Zettelkasten 第二记忆系统架构图

## 1. 整体系统架构

```mermaid
flowchart TB
    subgraph User_Layer["👤 用户层"]
        User["用户/Agent"]
        CLI["CLI 命令行"]
        MCP["MCP 客户端"]
    end

    subgraph OpenClaw_Core["🖥️ OpenClaw 核心"]
        Agent_Runtime["Agent Runtime"]
        Memory_Host["Memory Host SDK"]
        Session_Mgr["Session Manager"]
        Task_Registry["Task Registry"]
    end

    subgraph Zettelkasten_System["🧠 Zettelkasten 第二记忆系统"]
        Zettel_Engine["Zettelkasten Engine"]
        
        subgraph Core_Modules["核心模块"]
            Note_Service["Note Service<br/>笔记服务"]
            Link_Service["Link Service<br/>链接服务"]
            Tag_Service["Tag Service<br/>标签服务"]
            CEQRC_Engine["CEQRC Engine<br/>工作流引擎"]
            Search_Engine["Search Engine<br/>搜索引擎"]
            Graph_Engine["Graph Engine<br/>图谱引擎"]
        end
        
        subgraph Integration_Layer["集成层"]
            Memory_Bridge["Memory Host Bridge"]
            Session_Bridge["Session Bridge"]
            MCP_Server["MCP Server"]
        end
    end

    subgraph Storage_Layer["💾 存储层"]
        subgraph SQLite_DB["SQLite 数据库"]
            Notes_Table["zettel_notes<br/>笔记表"]
            Links_Table["zettel_links<br/>链接表"]
            Tags_Table["zettel_tags<br/>标签表"]
            Note_Tags_Table["zettel_note_tags<br/>笔记标签关联"]
            FTS_Table["zettel_fts<br/>全文搜索索引"]
            Vector_Table["sqlite-vec<br/>向量索引"]
        end
        Markdown_Files["📄 Markdown 文件<br/>源数据存储"]
    end

    User --> CLI
    User --> MCP
    CLI --> Agent_Runtime
    MCP --> MCP_Server
    
    Agent_Runtime --> Zettel_Engine
    Memory_Host --> Memory_Bridge
    Session_Mgr --> Session_Bridge
    
    Zettel_Engine --> Note_Service
    Zettel_Engine --> Link_Service
    Zettel_Engine --> Tag_Service
    Zettel_Engine --> CEQRC_Engine
    Zettel_Engine --> Search_Engine
    Zettel_Engine --> Graph_Engine
    
    Note_Service --> Notes_Table
    Note_Service --> FTS_Table
    Note_Service --> Markdown_Files
    
    Link_Service --> Links_Table
    Tag_Service --> Tags_Table
    Tag_Service --> Note_Tags_Table
    
    Search_Engine --> FTS_Table
    Search_Engine --> Vector_Table
    Graph_Engine --> Links_Table
    
    Memory_Bridge --> SQLite_DB
    Session_Bridge --> Notes_Table
    MCP_Server --> Zettel_Engine
```

## 2. 数据模型关系图

```mermaid
erDiagram
    ZETTEL_NOTE ||--o{ ZETTEL_LINK : "from_note"
    ZETTEL_NOTE ||--o{ ZETTEL_LINK : "to_note"
    ZETTEL_NOTE ||--o{ ZETTEL_NOTE_TAG : "has"
    ZETTEL_TAG ||--o{ ZETTEL_NOTE_TAG : "assigned_to"
    ZETTEL_NOTE ||--o{ ZETTEL_FTS : "indexed_by"

    ZETTEL_NOTE {
        string id PK "YYYYMMDDHHMMSS"
        string title
        string content
        string summary
        string status "FLEETING|LITERATURE|PERMANENT"
        string source
        string session_key
        datetime created_at
        datetime updated_at
        json metadata
    }

    ZETTEL_LINK {
        string id PK
        string from_note_id FK
        string to_note_id FK
        string type "supports|refines|extends|contradicts|related"
        string description
        string session_key
        datetime created_at
    }

    ZETTEL_TAG {
        string id PK
        string name UK
        string description
        string color
        int note_count
        datetime created_at
    }

    ZETTEL_NOTE_TAG {
        string note_id FK
        string tag_id FK
    }

    ZETTEL_FTS {
        string title
        string content
        string summary
        string id FK
    }
```

## 3. CEQRC 工作流流程图

```mermaid
flowchart LR
    subgraph Input["输入"]
        Idea["💡 想法/灵感"]
    end

    subgraph CEQRC_Workflow["CEQRC 工作流"]
        Capture["📥 Capture<br/>捕获"]
        Explain["📝 Explain<br/>解释"]
        Question["❓ Question<br/>提问"]
        Refine["✨ Refine<br/>精炼"]
        Connect["🔗 Connect<br/>连接"]
    end

    subgraph Output["输出"]
        Permanent_Note["📚 永久笔记"]
        Knowledge_Graph["🕸️ 知识图谱"]
    end

    Idea --> Capture
    Capture -->|创建临时笔记| Explain
    Explain -->|添加详细解释| Question
    Question -->|AI生成问题| Refine
    Refine -->|基于问题改进| Connect
    Connect -->|发现相关链接| Permanent_Note
    Connect -->|建立链接| Knowledge_Graph

    style Capture fill:#e1f5fe
    style Explain fill:#e8f5e9
    style Question fill:#fff3e0
    style Refine fill:#fce4ec
    style Connect fill:#f3e5f5
```

## 4. 笔记状态流转图

```mermaid
stateDiagram-v2
    [*] --> FLEETING: 快速捕获
    
    FLEETING --> LITERATURE: 添加来源和引用
    FLEETING --> PERMANENT: 直接提炼
    FLEETING --> ARCHIVED: 废弃
    
    LITERATURE --> PERMANENT: 用自己的话重写
    LITERATURE --> ARCHIVED: 不需要
    
    PERMANENT --> [*]: 成为知识图谱节点
    ARCHIVED --> [*]: 存储但不索引

    note right of FLEETING
        临时笔记
        快速记录想法
    end note

    note right of LITERATURE
        文献笔记
        摘录和理解
    end note

    note right of PERMANENT
        永久笔记
        独立完整的知识
    end note
```

## 5. 链接类型语义图

```mermaid
flowchart TB
    subgraph Link_Types["链接类型语义"]
        direction TB
        
        subgraph Support["论证关系"]
            A1["笔记 A"] -->|supports| B1["笔记 B"]
            B1 -->|supported_by| A1
        end
        
        subgraph Refine["细化关系"]
            A2["笔记 A"] -->|refines| B2["笔记 B"]
            B2 -->|refined_by| A2
        end
        
        subgraph Extend["扩展关系"]
            A3["笔记 A"] -->|extends| B3["笔记 B"]
            B3 -->|extended_by| A3
        end
        
        subgraph Contradict["对立关系"]
            A4["笔记 A"] -->|contradicts| B4["笔记 B"]
            B4 -->|contradicted_by| A4
        end
        
        subgraph Example["实例关系"]
            A5["笔记 A"] -->|is_example_of| B5["笔记 B"]
            B5 -->|has_example| A5
        end
        
        subgraph Related["一般关联"]
            A6["笔记 A"] -->|related| B6["笔记 B"]
        end
    end
```

## 6. 搜索架构图

```mermaid
flowchart LR
    subgraph Search_Input["搜索输入"]
        Query["用户查询"]
    end

    subgraph Search_Modes["搜索模式"]
        Full_Text["全文搜索<br/>FTS5"]
        Semantic["语义搜索<br/>Embedding"]
        Hybrid["混合搜索<br/>Combined"]
        Graph["图谱搜索<br/>Graph Traversal"]
    end

    subgraph Search_Process["搜索处理"]
        Query_Expansion["查询扩展<br