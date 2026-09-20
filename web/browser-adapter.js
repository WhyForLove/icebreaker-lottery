(function (root) {
  'use strict';

  const SUPPORTED_IMAGE_PATTERN = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
  const AVATAR_HANDLE_DB = 'icebreaker-local-settings';
  const AVATAR_HANDLE_STORE = 'handles';
  const AVATAR_HANDLE_KEY = 'avatar-directory';
  let avatarDirectoryHandle = null;

  const isSupportedImageName = name => SUPPORTED_IMAGE_PATTERN.test(String(name || ''));
  const avatarSource = file => ['..', 'shared', 'defaults', '头像', file]
    .map(part => part === '..' ? part : encodeURIComponent(part))
    .join('/');

  function openAvatarHandleDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('当前浏览器不能保存文件夹绑定。'));
        return;
      }
      const request = indexedDB.open(AVATAR_HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(AVATAR_HANDLE_STORE)) request.result.createObjectStore(AVATAR_HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地设置。'));
    });
  }

  async function readStoredAvatarDirectory() {
    try {
      const database = await openAvatarHandleDatabase();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(AVATAR_HANDLE_STORE, 'readonly');
        const request = transaction.objectStore(AVATAR_HANDLE_STORE).get(AVATAR_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      });
    } catch {
      return null;
    }
  }

  async function storeAvatarDirectory(directory) {
    try {
      const database = await openAvatarHandleDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(AVATAR_HANDLE_STORE, 'readwrite');
        transaction.objectStore(AVATAR_HANDLE_STORE).put(directory, AVATAR_HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    } catch {
      // Some local-file browser contexts cannot persist file-system handles.
    }
  }

  async function validateAvatarDirectory(directory) {
    if (!directory || directory.name !== '头像') throw new Error('请选择当前项目中的“头像”文件夹。');
    try {
      await directory.getFileHandle('avatars.js');
    } catch {
      throw new Error('所选文件夹中没有 avatars.js，请选择当前项目使用的“头像”文件夹。');
    }
  }

  async function requestDirectoryPermission(directory) {
    if (typeof directory.queryPermission !== 'function') return true;
    const options = { mode: 'readwrite' };
    if (await directory.queryPermission(options) === 'granted') return true;
    return typeof directory.requestPermission === 'function' && await directory.requestPermission(options) === 'granted';
  }

  async function chooseAvatarDirectory(forcePicker = false) {
    if (location.protocol !== 'file:') {
      throw new Error('永久增删改只能在本地打开 index.html 时使用；在线页面不能改写服务器文件。');
    }
    if (typeof root.showDirectoryPicker !== 'function') {
      throw new Error('当前浏览器不支持写入本地文件夹，请使用最新版 Edge 或 Chrome。');
    }
    if (!forcePicker) {
      if (!avatarDirectoryHandle) avatarDirectoryHandle = await readStoredAvatarDirectory();
      if (avatarDirectoryHandle) {
        try {
          if (await requestDirectoryPermission(avatarDirectoryHandle)) {
            await validateAvatarDirectory(avatarDirectoryHandle);
            return avatarDirectoryHandle;
          }
        } catch {
          avatarDirectoryHandle = null;
        }
      }
    }
    const directory = await root.showDirectoryPicker({ id: 'icebreaker-avatar-folder', mode: 'readwrite' });
    await validateAvatarDirectory(directory);
    avatarDirectoryHandle = directory;
    await storeAvatarDirectory(directory);
    return directory;
  }

  function manifestRecords(roster) {
    return roster.map((entry, index) => ({
      id: index,
      number: index + 1,
      numberedName: `小伙伴${index + 1}`,
      nickname: String(entry.nickname || '').trim(),
      file: entry.file,
      src: avatarSource(entry.file),
    }));
  }

  async function writeAvatarManifest(directory, roster) {
    const manifest = await directory.getFileHandle('avatars.js', { create: true });
    const writable = await manifest.createWritable();
    const content = `window.DEFAULT_AVATARS = ${JSON.stringify(manifestRecords(roster), null, 2)};\n`;
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
  }

  function uniqueFileName(original, reservedNames) {
    const dot = original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const extension = dot > 0 ? original.slice(dot) : '';
    let candidate = original;
    let suffix = 2;
    while (reservedNames.has(candidate.toLocaleLowerCase('zh-CN'))) candidate = `${stem} (${suffix++})${extension}`;
    reservedNames.add(candidate.toLocaleLowerCase('zh-CN'));
    return candidate;
  }

  root.partnerAdapter = {
    capabilities: {
      temporaryFolder: true,
      folderBinding: true,
    },

    async loadRoster() {
      return (root.DEFAULT_AVATARS || []).map(({ file, nickname }) => ({ file, nickname }));
    },

    async getAvatarSrc(file) {
      return new URL(avatarSource(file), location.href).href;
    },

    async getBindingStatus() {
      if (!avatarDirectoryHandle) avatarDirectoryHandle = await readStoredAvatarDirectory();
      return avatarDirectoryHandle?.name === '头像' ? '已记录' : '未绑定';
    },

    async bindFolder() {
      await chooseAvatarDirectory(true);
      return '已授权';
    },

    async saveOrder({ roster }) {
      const directory = await chooseAvatarDirectory();
      await writeAvatarManifest(directory, roster);
      return { roster, warnings: [] };
    },

    async addPartners({ roster, drafts }) {
      const directory = await chooseAvatarDirectory();
      const written = [];
      try {
        const reserved = new Set();
        for await (const name of directory.keys()) reserved.add(name.toLocaleLowerCase('zh-CN'));
        const additions = [];
        for (const item of drafts) {
          const fileName = uniqueFileName(item.file.name, reserved);
          const handle = await directory.getFileHandle(fileName, { create: true });
          const writable = await handle.createWritable();
          try {
            await writable.write(item.file);
          } finally {
            await writable.close();
          }
          written.push(fileName);
          additions.push({ file: fileName, nickname: item.nickname.trim() });
        }
        const nextRoster = [...roster, ...additions];
        await writeAvatarManifest(directory, nextRoster);
        return { roster: nextRoster, warnings: [] };
      } catch (error) {
        for (const name of written) {
          try { await directory.removeEntry(name); } catch { /* best-effort rollback */ }
        }
        throw error;
      }
    },

    async editPartner({ roster, originalFile, nickname, replacementFile }) {
      const directory = await chooseAvatarDirectory();
      let writtenFile = null;
      let oldFileDeleteFailed = false;
      try {
        const nextRoster = roster.map(entry => ({ ...entry }));
        const currentIndex = nextRoster.findIndex(entry => entry.file === originalFile);
        if (currentIndex < 0) throw new Error('找不到要修改的伙伴。');
        const updated = nextRoster[currentIndex];
        updated.nickname = nickname;
        if (replacementFile) {
          const reserved = new Set();
          for await (const name of directory.keys()) reserved.add(name.toLocaleLowerCase('zh-CN'));
          writtenFile = uniqueFileName(replacementFile.name, reserved);
          const handle = await directory.getFileHandle(writtenFile, { create: true });
          const writable = await handle.createWritable();
          try {
            await writable.write(replacementFile);
          } finally {
            await writable.close();
          }
          updated.file = writtenFile;
        }
        await writeAvatarManifest(directory, nextRoster);
        if (writtenFile) {
          try { await directory.removeEntry(originalFile); } catch { oldFileDeleteFailed = true; }
        }
        return {
          roster: nextRoster,
          warnings: oldFileDeleteFailed ? ['旧头像未能删除，请手动检查“头像”文件夹。'] : [],
        };
      } catch (error) {
        if (writtenFile) {
          try { await directory.removeEntry(writtenFile); } catch { /* best-effort rollback */ }
        }
        throw error;
      }
    },

    async deletePartners({ roster, files }) {
      const directory = await chooseAvatarDirectory();
      const selected = new Set(files);
      const nextRoster = roster.filter(entry => !selected.has(entry.file));
      await writeAvatarManifest(directory, nextRoster);
      let failed = 0;
      for (const file of selected) {
        try { await directory.removeEntry(file); } catch { failed++; }
      }
      return {
        roster: nextRoster,
        warnings: failed ? [`有 ${failed} 个图片文件未能从磁盘删除，请手动检查“头像”文件夹。`] : [],
      };
    },

    async loadTemporaryFiles(files, roster) {
      const relativeName = file => file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
      const candidates = files
        .filter(file => isSupportedImageName(file.name))
        .sort((a, b) => relativeName(a).localeCompare(relativeName(b), 'zh-CN', { numeric: true }) || (relativeName(a) < relativeName(b) ? -1 : 1));
      const indexedFiles = new Map(roster.map(entry => [entry.file, entry]));
      const accepted = [];
      const objectUrls = [];
      let failed = 0;
      for (const file of candidates) {
        const src = URL.createObjectURL(file);
        const image = new Image();
        image.src = src;
        try {
          await image.decode();
          const indexed = indexedFiles.get(relativeName(file));
          accepted.push({
            nickname: indexed?.nickname || file.name.replace(/\.[^.]+$/, ''),
            file: relativeName(file),
            src,
          });
          objectUrls.push(src);
        } catch {
          URL.revokeObjectURL(src);
          failed++;
        }
      }
      return { roster: accepted, objectUrls, failed, candidateCount: candidates.length };
    },
  };
})(globalThis);
