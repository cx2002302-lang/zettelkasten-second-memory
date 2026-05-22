import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "zettelkasten",
  name: "Zettelkasten Second Memory System",
  description: "Atomic note-taking, bi-directional linking, and knowledge-graph distillation for OpenClaw.",
  register(api) {
    api.registerCli(() => {}, {
      descriptors: [
        {
          name: "zk",
          description: "Zettelkasten second memory system commands",
          hasSubcommands: true,
        },
      ],
      commands: ["zk"],
    });
  },
});
