import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
  RequestUrlParam,
} from "obsidian";

// ============================================================================
// Settings
// ============================================================================

interface CortezaSettings {
  apiKey: string;
  serverUrl: string;
  autoExtract: boolean;
  showNotifications: boolean;
}

const DEFAULT_SETTINGS: CortezaSettings = {
  apiKey: "",
  serverUrl: "https://corteza.app",
  autoExtract: true,
  showNotifications: true,
};

// ============================================================================
// Main Plugin
// ============================================================================

export default class CortezaPlugin extends Plugin {
  settings: CortezaSettings;

  async onload() {
    await this.loadSettings();

    // Add ribbon icon
    this.addRibbonIcon("brain", "Send to Corteza", () => {
      this.sendCurrentNote();
    });

    // Command: Send entire note
    this.addCommand({
      id: "send-note-to-corteza",
      name: "Send entire note to Corteza",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        const fileName = view.file?.basename || "Untitled";
        this.sendToCorteza(content, fileName);
      },
    });

    // Command: Send selection
    this.addCommand({
      id: "send-selection-to-corteza",
      name: "Send selection to Corteza",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }
        const fileName = view.file?.basename || "Untitled";
        this.sendToCorteza(selection, fileName);
      },
    });

    // Command: Send selection as specific type
    this.addCommand({
      id: "send-as-decision",
      name: "Send selection as Decision",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }
        const fileName = view.file?.basename || "Untitled";
        this.sendDirectToCorteza(selection, "decision", fileName);
      },
    });

    this.addCommand({
      id: "send-as-explanation",
      name: "Send selection as Explanation",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }
        const fileName = view.file?.basename || "Untitled";
        this.sendDirectToCorteza(selection, "explanation", fileName);
      },
    });

    this.addCommand({
      id: "send-as-context",
      name: "Send selection as Context",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }
        const fileName = view.file?.basename || "Untitled";
        this.sendDirectToCorteza(selection, "context", fileName);
      },
    });

    // Add settings tab
    this.addSettingTab(new CortezaSettingTab(this.app, this));

    // Register context menu
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("Send to Corteza")
              .setIcon("brain")
              .onClick(() => {
                const fileName = view.file?.basename || "Untitled";
                this.sendToCorteza(selection, fileName);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle("Send as Decision")
              .setIcon("check-circle")
              .onClick(() => {
                const fileName = view.file?.basename || "Untitled";
                this.sendDirectToCorteza(selection, "decision", fileName);
              });
          });
        }
      })
    );

    console.log("Corteza plugin loaded");
  }

  onunload() {
    console.log("Corteza plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Send current note (from ribbon icon)
  async sendCurrentNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active markdown note");
      return;
    }

    const content = view.editor.getValue();
    const fileName = view.file?.basename || "Untitled";
    await this.sendToCorteza(content, fileName);
  }

  // Send content to Corteza with AI extraction
  async sendToCorteza(content: string, fileName: string) {
    if (!this.settings.apiKey) {
      new Notice("Please configure your Corteza API key in settings");
      return;
    }

    if (!content.trim()) {
      new Notice("No content to send");
      return;
    }

    const notice = new Notice("Sending to Corteza...", 0);

    try {
      const url = `${this.settings.serverUrl}/api/v1/import/obsidian`;

      const response = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          text: content,
          fileName: fileName,
          saveDirectly: this.settings.autoExtract,
        }),
      });

      notice.hide();

      if (response.status === 200) {
        const data = response.json;
        if (data.success) {
          if (data.saved > 0) {
            new Notice(`Imported ${data.saved} decisions from "${fileName}"`);
          } else if (data.decisions?.length === 0) {
            new Notice("No decisions found in the note");
          } else {
            new Notice(data.message || "Sent to Corteza");
          }
        } else {
          new Notice(`Error: ${data.error || "Unknown error"}`);
        }
      } else {
        new Notice(`Failed to send: HTTP ${response.status}`);
      }
    } catch (error) {
      notice.hide();
      console.error("Corteza error:", error);
      new Notice(`Failed to connect to Corteza: ${error.message}`);
    }
  }

  // Send content directly as a specific type (no AI extraction)
  async sendDirectToCorteza(
    content: string,
    type: string,
    fileName: string
  ) {
    if (!this.settings.apiKey) {
      new Notice("Please configure your Corteza API key in settings");
      return;
    }

    if (!content.trim()) {
      new Notice("No content to send");
      return;
    }

    const notice = new Notice(`Saving ${type}...`, 0);

    try {
      const url = `${this.settings.serverUrl}/api/v1/import/obsidian/direct`;

      const response = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          text: content,
          type: type,
          fileName: fileName,
        }),
      });

      notice.hide();

      if (response.status === 200) {
        const data = response.json;
        if (data.success) {
          new Notice(`Saved as ${type} #${data.decision?.id}`);
        } else {
          new Notice(`Error: ${data.error || "Unknown error"}`);
        }
      } else {
        new Notice(`Failed to save: HTTP ${response.status}`);
      }
    } catch (error) {
      notice.hide();
      console.error("Corteza error:", error);
      new Notice(`Failed to connect to Corteza: ${error.message}`);
    }
  }
}

// ============================================================================
// Settings Tab
// ============================================================================

class CortezaSettingTab extends PluginSettingTab {
  plugin: CortezaPlugin;

  constructor(app: App, plugin: CortezaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Corteza Settings" });

    // API Key
    new Setting(containerEl)
      .setName("API Key")
      .setDesc(
        "Your Corteza API key. Generate one from Settings in the Corteza dashboard."
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter your API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // Server URL
    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("Corteza server URL (change only if self-hosting)")
      .addText((text) =>
        text
          .setPlaceholder("https://corteza.app")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.replace(/\/$/, ""); // Remove trailing slash
            await this.plugin.saveSettings();
          })
      );

    // Auto Extract
    new Setting(containerEl)
      .setName("Auto-extract decisions")
      .setDesc(
        "When enabled, AI will automatically extract and save decisions from your notes. When disabled, extracted decisions will need confirmation."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoExtract)
          .onChange(async (value) => {
            this.plugin.settings.autoExtract = value;
            await this.plugin.saveSettings();
          })
      );

    // Help section
    containerEl.createEl("h3", { text: "How to use" });

    const helpList = containerEl.createEl("ul");
    helpList.createEl("li", {
      text: "Use the brain icon in the ribbon to send the current note",
    });
    helpList.createEl("li", {
      text: 'Use Command Palette (Cmd/Ctrl+P) and search for "Corteza"',
    });
    helpList.createEl("li", {
      text: 'Right-click selected text and choose "Send to Corteza"',
    });
    helpList.createEl("li", {
      text: '"Send as Decision/Explanation/Context" saves directly without AI extraction',
    });

    // Test connection button
    new Setting(containerEl)
      .setName("Test Connection")
      .setDesc("Verify your API key works")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          if (!this.plugin.settings.apiKey) {
            new Notice("Please enter an API key first");
            return;
          }

          button.setButtonText("Testing...");
          button.setDisabled(true);

          try {
            const url = `${this.plugin.settings.serverUrl}/api/v1/import/obsidian`;
            const response = await requestUrl({
              url,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.plugin.settings.apiKey}`,
              },
              body: JSON.stringify({
                text: "",
                fileName: "test",
              }),
            });

            // 400 is expected for empty text, but means auth worked
            if (response.status === 400 || response.status === 200) {
              new Notice("Connection successful!");
            } else if (response.status === 401) {
              new Notice("Invalid API key");
            } else {
              new Notice(`Connection failed: HTTP ${response.status}`);
            }
          } catch (error) {
            new Notice(`Connection failed: ${error.message}`);
          }

          button.setButtonText("Test");
          button.setDisabled(false);
        })
      );
  }
}
