(function (root) {
  'use strict';

  const invoke = root.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error('当前页面不在 Tauri 桌面环境中。');

  const avatarCache = new Map();

  async function invokeCommand(command, payload) {
    try {
      return await invoke(command, payload);
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(String(error));
    }
  }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function draftPayload(item) {
    return {
      name: item.file.name,
      nickname: item.nickname.trim(),
      dataBase64: await fileToBase64(item.file),
    };
  }

  async function replacementPayload(file) {
    if (!file) return null;
    return {
      name: file.name,
      dataBase64: await fileToBase64(file),
    };
  }

  function clearAvatarCache() {
    avatarCache.clear();
  }

  root.partnerAdapter = {
    capabilities: {
      temporaryFolder: false,
      folderBinding: false,
    },

    async loadRoster() {
      clearAvatarCache();
      return invokeCommand('load_roster');
    },

    async getAvatarSrc(file) {
      if (!avatarCache.has(file)) {
        const avatar = await invokeCommand('read_avatar', { file });
        avatarCache.set(file, `data:${avatar.mime};base64,${avatar.dataBase64}`);
      }
      return avatarCache.get(file);
    },

    async getBindingStatus() {
      return '';
    },

    async bindFolder() {
      throw new Error('桌面版不需要绑定头像文件夹。');
    },

    async saveOrder({ roster }) {
      const result = await invokeCommand('save_order', { roster });
      clearAvatarCache();
      return result;
    },

    async addPartners({ roster, drafts }) {
      const payloads = [];
      for (const item of drafts) payloads.push(await draftPayload(item));
      const result = await invokeCommand('add_partners', { roster, drafts: payloads });
      clearAvatarCache();
      return result;
    },

    async editPartner({ roster, originalFile, nickname, replacementFile }) {
      const result = await invokeCommand('edit_partner', {
        roster,
        originalFile,
        nickname,
        replacementFile: await replacementPayload(replacementFile),
      });
      clearAvatarCache();
      return result;
    },

    async deletePartners({ roster, files }) {
      const result = await invokeCommand('delete_partners', { roster, files });
      clearAvatarCache();
      return result;
    },

    async loadTemporaryFiles() {
      throw new Error('桌面版不使用临时图片文件夹。');
    },
  };
})(globalThis);
