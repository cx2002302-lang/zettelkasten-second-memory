# Zettelkasten 第二记忆系统 - 架构信息图

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

## 6. MCP 工具接口图

```mermaid
flowchart TB
    subgraph MCP_Client["MCP 客户端"]
        Claude["Claude Desktop"]
        Cursor["Cursor"]
        Other["其他 MCP 客户端"]
    end

    subgraph Zettelkasten_MCP_Server["Zettelkasten MCP Server"]
        Tools["MCP Tools"]
        
        subgraph Note_Tools["笔记工具"]
            Create_Note["zettel_create_note"]
            Get_Note["zettel_get_note"]
            Update_Note["zettel_update_note"]
            Delete_Note["zettel_delete_note"]
            Search_Notes["zettel_search_notes"]
        end
        
        subgraph Link_Tools["链接工具"]
            Create_Link["zettel_create_link"]
            Get_Backlinks["zettel_get_backlinks"]
            Suggest_Links["zettel_suggest_links"]
            Get_Graph["zettel_get_note_graph"]
        end
        
        subgraph Workflow_Tools["工作流工具"]
            Run_CEQRC["zettel_run_ceqrc"]
            Generate_Summary["zettel_generate_summary"]
            Suggest_Tags["zettel_suggest_tags"]
        end
    end

    subgraph Zettelkasten_Engine["Zettelkasten Engine"]
        Note_Service["Note Service"]
        Link_Service["Link Service"]
        CEQRC_Engine["CEQRC Engine"]
    end

    Claude --> Tools
    Cursor --> Tools
    Other --> Tools
    
    Tools --> Note_Tools
    Tools --> Link_Tools
    Tools --> Workflow_Tools
    
    Note_Tools --> Note_Service
    Link_Tools --> Link_Service
    Workflow_Tools --> CEQRC_Engine
```

## 7. 与 OpenClaw 集成架构图

```mermaid
flowchart TB
    subgraph OpenClaw_Existing["OpenClaw 现有系统"]
        Memory_Host["Memory Host SDK<br/>已有 SQLite + FTS5 + 向量搜索"]
        Session_Mgr["Session Manager<br/>会话管理"]
        Task_Registry["Task Registry<br/>任务注册表"]
        Agent_Runtime["Agent Runtime<br/>Agent 运行时"]
    end

    subgraph Zettelkasten_New["Zettelkasten 新增模块"]
        Zettel_Engine["Zettelkasten Engine"]
        
        subgraph Integration_Points["集成点"]
            Memory_Bridge["Memory Host Bridge<br/>复用数据库连接"]
            Session_Bridge["Session Bridge<br/>会话关联笔记"]
            Task_Integration["Task Integration<br/>CEQRC 作为任务流"]
        end
    end

    subgraph Storage["存储层"]
        SQLite["SQLite 数据库"]
        Markdown["Markdown 文件"]
    end

    Agent_Runtime --> Zettel_Engine
    
    Zettel_Engine --> Memory_Bridge
    Zettel_Engine --> Session_Bridge
    Zettel_Engine --> Task_Integration
    
    Memory_Bridge --> Memory_Host
    Session_Bridge --> Session_Mgr
    Task_Integration --> Task_Registry
    
    Memory_Host --> SQLite
    Zettel_Engine --> SQLite
    Zettel_Engine --> Markdown
```

## 8. 模块依赖关系图

```mermaid
flowchart TB
    subgraph Core_Layer["核心层"]
        Core_Types["types.ts<br/>类型定义"]
        Core_Note["note.ts<br/>笔记实体"]
        Core_Link["link.ts<br/>链接实体"]
        Core_Tag["tag.ts<br/>标签实体"]
    end

    subgraph Repository_Layer["数据访问层"]
        Repo_Note["note-repository.ts"]
        Repo_Link["link-repository.ts"]
        Repo_Tag["tag-repository.ts"]
    end

    subgraph Service_Layer["服务层"]
        Service_Note["NoteService"]
        Service_Link["LinkService"]
        Service_Tag["TagService"]
        Service_Search["SearchService"]
    end

    subgraph Engine_Layer["引擎层"]
        Engine_Zettel["ZettelEngine"]
        Engine_Graph["GraphEngine"]
        Engine_Query["QueryEngine"]
    end

    subgraph Workflow_Layer["工作流层"]
        Workflow_CEQRC["CEQRCEngine"]
    end

    subgraph Integration_Layer["集成层"]
        Integration_Memory["MemoryHostBridge"]
        Integration_Session["SessionBridge"]
        Integration_MCP["MCPServer"]
    end

    Core_Types --> Core_Note
    Core_Types --> Core_Link
    Core_Types --> Core_Tag
    
    Core_Note --> Repo_Note
    Core_Link --> Repo_Link
    Core_Tag --> Repo_Tag
    
    Repo_Note --> Service_Note
    Repo_Link --> Service_Link
    Repo_Tag --> Service_Tag
    Repo_Note --> Service_Search
    
    Service_Note --> Engine_Zettel
    Service_Link --> Engine_Graph
    Service_Search --> Engine_Query
    
    Engine_Zettel --> Workflow_CEQRC
    
    Service_Note --> Integration_Memory
    Service_Note --> Integration_Session
    Engine_Zettel --> Integration_MCP
```

---

## 图例说明

| 符号 | 含义 |
|------|------|
| 🧠 | 核心系统 |
| 💾 | 存储组件 |
| 📄 | 文件存储 |
| 🔗 | 链接/关系 |
| 📥 | 输入/捕获 |
| 📚 | 输出/永久存储 |
| 💡 | 想法/灵感 |
| ❓ | 问题/疑问 |
| ✨ | 精炼/改进 |
| 🕸️ | 知识图谱 |
| 👤 | 用户 |
| 🖥️ | 系统组件 |