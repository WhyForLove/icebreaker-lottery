#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as FmtWrite;
use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MANIFEST_PREFIX: &str = "window.DEFAULT_AVATARS =";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Partner {
    file: String,
    nickname: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncomingPartner {
    name: String,
    nickname: String,
    data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplacementFile {
    name: String,
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarPayload {
    mime: String,
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MutationResult {
    roster: Vec<Partner>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestRecord {
    id: usize,
    number: usize,
    numbered_name: String,
    nickname: String,
    file: String,
    src: String,
}

fn avatar_directory() -> Result<PathBuf, String> {
    let source_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("shared")
        .join("defaults")
        .join("头像");
    let executable_directory = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|directory| {
            directory
                .join("..")
                .join("shared")
                .join("defaults")
                .join("头像")
        });

    executable_directory
        .into_iter()
        .chain(std::iter::once(source_directory))
        .find_map(|directory| directory.canonicalize().ok())
        .ok_or_else(|| "无法定位 shared/defaults/头像，请确认 EXE 仍位于项目的 desktop 目录。".to_string())
}

fn manifest_path(directory: &Path) -> PathBuf {
    directory.join("avatars.js")
}

fn load_manifest(directory: &Path) -> Result<Vec<Partner>, String> {
    let content = fs::read_to_string(manifest_path(directory))
        .map_err(|error| format!("无法读取 avatars.js：{error}"))?;
    let json = content
        .trim()
        .strip_prefix(MANIFEST_PREFIX)
        .ok_or_else(|| "avatars.js 格式不正确。".to_string())?
        .trim()
        .strip_suffix(';')
        .ok_or_else(|| "avatars.js 缺少结尾分号。".to_string())?;
    serde_json::from_str(json).map_err(|error| format!("无法解析 avatars.js：{error}"))
}

fn is_supported_image(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
            )
        })
        .unwrap_or(false)
}

fn validate_file_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || Path::new(name).file_name().and_then(|value| value.to_str()) != Some(name)
        || Path::new(name).components().count() != 1
    {
        return Err(format!("不安全的头像文件名：{name}"));
    }
    if !is_supported_image(name) {
        return Err(format!("不支持的图片类型：{name}"));
    }
    Ok(())
}

fn validate_roster(roster: &[Partner]) -> Result<(), String> {
    let mut files = HashSet::new();
    for partner in roster {
        validate_file_name(&partner.file)?;
        if partner.nickname.trim().is_empty() {
            return Err(format!("{} 的昵称不能为空。", partner.file));
        }
        if !files.insert(partner.file.to_lowercase()) {
            return Err(format!("名册中存在重复文件名：{}", partner.file));
        }
    }
    Ok(())
}

fn require_current_roster(directory: &Path, roster: &[Partner]) -> Result<(), String> {
    if load_manifest(directory)? != roster {
        return Err("磁盘中的名册已经变化，请重新加载后再操作。".to_string());
    }
    Ok(())
}

fn require_same_partners(directory: &Path, roster: &[Partner]) -> Result<(), String> {
    let current = load_manifest(directory)?;
    if current.len() != roster.len() {
        return Err("磁盘中的名册已经变化，请重新加载后再操作。".to_string());
    }
    let current_map: HashMap<&str, &str> = current
        .iter()
        .map(|partner| (partner.file.as_str(), partner.nickname.as_str()))
        .collect();
    if roster.iter().any(|partner| {
        current_map.get(partner.file.as_str()).copied() != Some(partner.nickname.as_str())
    }) {
        return Err("磁盘中的名册已经变化，请重新加载后再操作。".to_string());
    }
    Ok(())
}

fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(byte) {
            encoded.push(*byte as char);
        } else {
            let _ = write!(&mut encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn manifest_content(roster: &[Partner]) -> Result<String, String> {
    let records: Vec<ManifestRecord> = roster
        .iter()
        .enumerate()
        .map(|(index, partner)| ManifestRecord {
            id: index,
            number: index + 1,
            numbered_name: format!("小伙伴{}", index + 1),
            nickname: partner.nickname.trim().to_string(),
            file: partner.file.clone(),
            src: format!(
                "%E5%A4%B4%E5%83%8F/{}",
                encode_uri_component(&partner.file)
            ),
        })
        .collect();
    let json = serde_json::to_string_pretty(&records)
        .map_err(|error| format!("无法生成头像名册：{error}"))?;
    Ok(format!("{MANIFEST_PREFIX} {json};\n"))
}

fn write_manifest(directory: &Path, roster: &[Partner]) -> Result<(), String> {
    validate_roster(roster)?;
    let manifest = manifest_path(directory);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间异常：{error}"))?
        .as_nanos();
    let temporary = directory.join(format!("avatars.js.tmp-{}-{nonce}", std::process::id()));
    let backup = directory.join(format!("avatars.js.bak-{}-{nonce}", std::process::id()));
    let content = manifest_content(roster)?;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("无法创建临时名册：{error}"))?;
    if let Err(error) = file.write_all(content.as_bytes()).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法写入临时名册：{error}"));
    }
    drop(file);

    let had_manifest = manifest.exists();
    if had_manifest {
        if let Err(error) = fs::rename(&manifest, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法备份现有名册：{error}"));
        }
    }
    if let Err(error) = fs::rename(&temporary, &manifest) {
        if had_manifest {
            let _ = fs::rename(&backup, &manifest);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法替换头像名册：{error}"));
    }
    if had_manifest {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn directory_file_names(directory: &Path) -> Result<HashSet<String>, String> {
    let mut names = HashSet::new();
    for entry in fs::read_dir(directory).map_err(|error| format!("无法读取头像目录：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取头像目录项：{error}"))?;
        if let Some(name) = entry.file_name().to_str() {
            names.insert(name.to_lowercase());
        }
    }
    Ok(names)
}

fn unique_file_name(original: &str, reserved: &mut HashSet<String>) -> String {
    let dot = original.rfind('.').filter(|index| *index > 0);
    let (stem, extension) = dot
        .map(|index| (&original[..index], &original[index..]))
        .unwrap_or((original, ""));
    let mut candidate = original.to_string();
    let mut suffix = 2;
    while reserved.contains(&candidate.to_lowercase()) {
        candidate = format!("{stem} ({suffix}){extension}");
        suffix += 1;
    }
    reserved.insert(candidate.to_lowercase());
    candidate
}

fn decode_file(data_base64: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(data_base64)
        .map_err(|error| format!("图片数据无法解码：{error}"))
}

fn write_new_file(directory: &Path, name: &str, data: &[u8]) -> Result<PathBuf, String> {
    validate_file_name(name)?;
    let path = directory.join(name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("无法创建头像 {name}：{error}"))?;
    if let Err(error) = file.write_all(data).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("无法写入头像 {name}：{error}"));
    }
    Ok(path)
}

fn mime_for_file(file: &str) -> Result<&'static str, String> {
    match Path::new(file)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => Ok("image/jpeg"),
        Some("png") => Ok("image/png"),
        Some("webp") => Ok("image/webp"),
        Some("gif") => Ok("image/gif"),
        Some("bmp") => Ok("image/bmp"),
        Some("avif") => Ok("image/avif"),
        _ => Err(format!("不支持的图片类型：{file}")),
    }
}

#[tauri::command]
fn load_roster() -> Result<Vec<Partner>, String> {
    let directory = avatar_directory()?;
    let roster = load_manifest(&directory)?;
    validate_roster(&roster)?;
    Ok(roster)
}

#[tauri::command]
fn read_avatar(file: String) -> Result<AvatarPayload, String> {
    validate_file_name(&file)?;
    let directory = avatar_directory()?;
    let path = directory.join(&file);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("无法读取头像 {file}：{error}"))?;
    if !canonical.starts_with(&directory) {
        return Err("头像路径超出允许的目录。".to_string());
    }
    let data = fs::read(&canonical).map_err(|error| format!("无法读取头像 {file}：{error}"))?;
    Ok(AvatarPayload {
        mime: mime_for_file(&file)?.to_string(),
        data_base64: BASE64.encode(data),
    })
}

#[tauri::command]
fn save_order(roster: Vec<Partner>) -> Result<MutationResult, String> {
    validate_roster(&roster)?;
    let directory = avatar_directory()?;
    require_same_partners(&directory, &roster)?;
    write_manifest(&directory, &roster)?;
    Ok(MutationResult {
        roster,
        warnings: vec![],
    })
}

#[tauri::command]
fn add_partners(
    roster: Vec<Partner>,
    drafts: Vec<IncomingPartner>,
) -> Result<MutationResult, String> {
    validate_roster(&roster)?;
    let directory = avatar_directory()?;
    require_current_roster(&directory, &roster)?;
    for draft in &drafts {
        if draft.nickname.trim().is_empty() {
            return Err("每张图片都需要填写昵称。".to_string());
        }
        validate_file_name(&draft.name)?;
    }
    let mut reserved = directory_file_names(&directory)?;
    let mut written = Vec::new();
    let mut next_roster = roster;

    for draft in drafts {
        let file_name = unique_file_name(&draft.name, &mut reserved);
        let data = match decode_file(&draft.data_base64) {
            Ok(data) => data,
            Err(error) => {
                for path in written {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        };
        match write_new_file(&directory, &file_name, &data) {
            Ok(path) => written.push(path),
            Err(error) => {
                for path in written {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        }
        next_roster.push(Partner {
            file: file_name,
            nickname: draft.nickname.trim().to_string(),
        });
    }

    if let Err(error) = write_manifest(&directory, &next_roster) {
        for path in written {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    Ok(MutationResult {
        roster: next_roster,
        warnings: vec![],
    })
}

#[tauri::command]
fn edit_partner(
    roster: Vec<Partner>,
    original_file: String,
    nickname: String,
    replacement_file: Option<ReplacementFile>,
) -> Result<MutationResult, String> {
    validate_roster(&roster)?;
    validate_file_name(&original_file)?;
    if nickname.trim().is_empty() {
        return Err("昵称不能为空。".to_string());
    }
    let directory = avatar_directory()?;
    require_current_roster(&directory, &roster)?;
    let mut next_roster = roster;
    let index = next_roster
        .iter()
        .position(|partner| partner.file == original_file)
        .ok_or_else(|| "找不到要修改的伙伴。".to_string())?;
    next_roster[index].nickname = nickname.trim().to_string();
    let mut written_path = None;

    if let Some(replacement) = replacement_file {
        validate_file_name(&replacement.name)?;
        let mut reserved = directory_file_names(&directory)?;
        let file_name = unique_file_name(&replacement.name, &mut reserved);
        let data = decode_file(&replacement.data_base64)?;
        let path = write_new_file(&directory, &file_name, &data)?;
        next_roster[index].file = file_name;
        written_path = Some(path);
    }

    if let Err(error) = write_manifest(&directory, &next_roster) {
        if let Some(path) = written_path {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }

    let mut warnings = Vec::new();
    if written_path.is_some() {
        if fs::remove_file(directory.join(&original_file)).is_err() {
            warnings.push("旧头像未能删除，请手动检查“头像”文件夹。".to_string());
        }
    }
    Ok(MutationResult {
        roster: next_roster,
        warnings,
    })
}

#[tauri::command]
fn delete_partners(roster: Vec<Partner>, files: Vec<String>) -> Result<MutationResult, String> {
    validate_roster(&roster)?;
    let directory = avatar_directory()?;
    require_current_roster(&directory, &roster)?;
    let selected: HashSet<String> = files.into_iter().collect();
    if selected
        .iter()
        .any(|file| !roster.iter().any(|partner| &partner.file == file))
    {
        return Err("删除列表包含名册中不存在的文件。".to_string());
    }
    for file in &selected {
        validate_file_name(file)?;
    }
    let next_roster: Vec<Partner> = roster
        .into_iter()
        .filter(|partner| !selected.contains(&partner.file))
        .collect();
    write_manifest(&directory, &next_roster)?;

    let mut failed = 0;
    for file in selected {
        if fs::remove_file(directory.join(file)).is_err() {
            failed += 1;
        }
    }
    let warnings = if failed > 0 {
        vec![format!(
            "有 {failed} 个图片文件未能从磁盘删除，请手动检查“头像”文件夹。"
        )]
    } else {
        vec![]
    };
    Ok(MutationResult {
        roster: next_roster,
        warnings,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_roster,
            read_avatar,
            save_order,
            add_partners,
            edit_partner,
            delete_partners
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Desktop V1.0.0");
}
