use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

const MAX_BYTES: u64 = 64 * 1024 * 1024;
static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub path: String,
    pub content: String,
    pub mtime_ms: u64,
    pub encoding: String,
}

fn map_io_error(err: std::io::Error, action: &str, path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    #[cfg(windows)]
    {
        match err.raw_os_error() {
            Some(32) | Some(33) | Some(1224) => {
                return format!("无法{action}「{name}」：文件正被其他程序占用");
            }
            Some(5) => return format!("无法{action}「{name}」：没有写入权限"),
            Some(3) => return format!("无法{action}「{name}」：找不到路径"),
            _ => {}
        }
    }
    format!("无法{action}「{name}」：{err}")
}

fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_document(path: String) -> Result<OpenedDocument, String> {
    let target = PathBuf::from(&path);
    let meta = fs::metadata(&target).map_err(|err| map_io_error(err, "打开", &target))?;
    if !meta.is_file() {
        return Err("只能打开文件".to_string());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("文件有 {} 字节，超过 64MB 上限", meta.len()));
    }
    let bytes = fs::read(&target).map_err(|err| map_io_error(err, "打开", &target))?;
    let (content, encoding) = decode_bytes(&bytes)?;
    Ok(OpenedDocument {
        path,
        content,
        encoding,
        mtime_ms: file_mtime_ms(&target),
    })
}

fn decode_bytes(bytes: &[u8]) -> Result<(String, String), String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let text = std::str::from_utf8(&bytes[3..]).map_err(|_| "文件不是 UTF-8 文本".to_string())?;
        return Ok((text.to_string(), "utf-8-bom".to_string()));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok((decode_utf16(&bytes[2..], true)?, "utf-16le".to_string()));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok((decode_utf16(&bytes[2..], false)?, "utf-16be".to_string()));
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok((text.to_string(), "utf-8".to_string()));
    }
    let (text, _, had_errors) = encoding_rs::GBK.decode(bytes);
    if had_errors {
        return Err("无法识别文件编码（已尝试 UTF-8、UTF-16、GBK）".to_string());
    }
    Ok((text.into_owned(), "gbk".to_string()))
}

fn decode_utf16(bytes: &[u8], little: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("UTF-16 字节长度不正确".to_string());
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if little {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect();
    String::from_utf16(&units).map_err(|_| "UTF-16 内容无法解码".to_string())
}

fn encode_text(content: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(content.as_bytes());
            Ok(bytes)
        }
        "utf-16le" => Ok(encode_utf16(content, true)),
        "utf-16be" => Ok(encode_utf16(content, false)),
        "gbk" => {
            let (bytes, _, had_errors) = encoding_rs::GBK.encode(content);
            if had_errors {
                return Err("有字符无法用 GBK 保存".to_string());
            }
            Ok(bytes.into_owned())
        }
        _ => Ok(content.as_bytes().to_vec()),
    }
}

fn encode_utf16(content: &str, little: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(2 + content.len() * 2);
    out.extend_from_slice(if little { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
    for unit in content.encode_utf16() {
        let bytes = if little {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        out.extend_from_slice(&bytes);
    }
    out
}

#[tauri::command]
pub fn write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    write_bytes_atomic(&path, &bytes)
}

#[tauri::command]
pub fn write_document(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    let bytes = encode_text(&content, encoding.as_deref().unwrap_or("utf-8"))?;
    write_bytes_atomic(&path, &bytes)
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

fn image_mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Read a referenced image as a `data:` URI so HTML/Word/PNG exports can embed
/// it instead of pointing at a path that only existed next to the source file.
#[tauri::command]
pub fn read_image_data_uri(path: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    let meta = fs::metadata(&target).map_err(|err| map_io_error(err, "读取", &target))?;
    if !meta.is_file() {
        return Err("只能读取文件".to_string());
    }
    if meta.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20MB".to_string());
    }
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let mime = image_mime(name).ok_or_else(|| "不是支持的图片格式".to_string())?;
    let bytes = fs::read(&target).map_err(|err| map_io_error(err, "读取", &target))?;
    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

fn write_bytes_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("没有保存路径".to_string());
    }
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| map_io_error(err, "保存", &target))?;
        }
    }

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let parent = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let temp = parent.join(format!(
        ".{file_name}.{}.{}.mosharp-tmp",
        std::process::id(),
        TEMP_NONCE.fetch_add(1, Ordering::Relaxed)
    ));

    let write_result = (|| -> Result<(), String> {
        let mut file =
            File::create(&temp).map_err(|err| map_io_error(err, "保存", &target))?;
        file.write_all(bytes)
            .map_err(|err| map_io_error(err, "保存", &target))?;
        file.sync_all()
            .map_err(|err| map_io_error(err, "保存", &target))?;
        rename_replace(&temp, &target).map_err(|err| map_io_error(err, "保存", &target))
    })();

    if write_result.is_err() && temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    write_result
}

#[cfg(windows)]
fn rename_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_wide = wide(from);
    let to_wide = wide(to);
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub relative: String,
    pub absolute: String,
}

fn image_extension(extension: &str) -> Result<&'static str, String> {
    match extension.trim().to_ascii_lowercase().as_str() {
        "png" => Ok("png"),
        "jpg" | "jpeg" => Ok("jpg"),
        "gif" => Ok("gif"),
        "webp" => Ok("webp"),
        "svg" => Ok("svg"),
        _ => Err("不支持的图片格式".to_string()),
    }
}

fn assets_dir_for(doc_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = doc_path.map(str::trim).filter(|path| !path.is_empty()) {
        let doc = PathBuf::from(path);
        let parent = match doc.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
            _ => PathBuf::from("."),
        };
        return Ok(parent.join("assets"));
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户目录".to_string())?;
    Ok(PathBuf::from(home).join(".mosharp").join("assets"))
}

fn safe_asset_name(relative: &str) -> Result<String, String> {
    let normalized = relative.replace('\\', "/");
    let name = normalized
        .strip_prefix("assets/")
        .ok_or_else(|| "图片必须放在 assets 目录".to_string())?;
    if name.is_empty()
        || name.contains('/')
        || name.contains("..")
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return Err("图片路径不安全".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn save_image(
    doc_path: Option<String>,
    bytes: Vec<u8>,
    extension: String,
) -> Result<SavedImage, String> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("图片超过 20MB".to_string());
    }
    if bytes.is_empty() {
        return Err("图片是空的".to_string());
    }
    let ext = image_extension(&extension)?;
    let dir = assets_dir_for(doc_path.as_deref())?;
    fs::create_dir_all(&dir).map_err(|err| map_io_error(err, "保存图片", &dir))?;
    let name = format!(
        "img-{}-{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0),
        TEMP_NONCE.fetch_add(1, Ordering::Relaxed),
        ext
    );
    let absolute = dir.join(&name);
    fs::write(&absolute, bytes).map_err(|err| map_io_error(err, "保存图片", &absolute))?;
    Ok(SavedImage {
        relative: format!("assets/{name}"),
        absolute: absolute.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn place_image(doc_path: String, relative: String, source: String) -> Result<(), String> {
    let name = safe_asset_name(&relative)?;
    let source_path = PathBuf::from(&source);
    if !source_path.is_file() {
        return Err("找不到要放进文档旁的图片".to_string());
    }
    let source_canon = source_path
        .canonicalize()
        .map_err(|err| map_io_error(err, "读取图片", &source_path))?;
    let dir = assets_dir_for(Some(doc_path.as_str()))?;
    fs::create_dir_all(&dir).map_err(|err| map_io_error(err, "保存图片", &dir))?;
    let dest = dir.join(name);
    if dest.exists() {
        let dest_canon = dest
            .canonicalize()
            .map_err(|err| map_io_error(err, "保存图片", &dest))?;
        if dest_canon == source_canon {
            return Ok(());
        }
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户目录".to_string())?;
    let allowed = PathBuf::from(home).join(".mosharp").join("assets");
    let allowed_canon = allowed
        .canonicalize()
        .map_err(|_| "图片不在可移动的目录里".to_string())?;
    if !source_canon.starts_with(&allowed_canon) {
        return Err("只能移动编辑器自己保存的图片".to_string());
    }
    fs::copy(&source_canon, &dest).map_err(|err| map_io_error(err, "保存图片", &dest))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{read_document, write_document};

    #[test]
    fn atomic_overwrite_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mosharp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        let path_str = path.to_string_lossy().into_owned();

        write_document(path_str.clone(), "第一版\n".to_string(), None).unwrap();
        write_document(path_str.clone(), "第二版\n".to_string(), None).unwrap();
        let opened = read_document(path_str).unwrap();
        assert_eq!(opened.content, "第二版\n");

        let leftover = std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("mosharp-tmp")
        });
        assert!(!leftover);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn crlf_roundtrip_keeps_carriage_returns() {
        let dir = std::env::temp_dir().join(format!("mosharp-crlf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        let path_str = path.to_string_lossy().into_owned();
        let original = "---\r\ntitle: 墨\r\n---\r\n\r\n甲\r\n\r\n***\r\n";

        write_document(path_str.clone(), original.to_string(), None).unwrap();
        let opened = read_document(path_str).unwrap();
        assert_eq!(opened.content, original);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn encoding_roundtrip_gbk_utf16_and_bom() {
        let dir = std::env::temp_dir().join(format!("mosharp-enc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        let path_str = path.to_string_lossy().into_owned();
        let text = "中文\r\n";

        write_document(path_str.clone(), text.to_string(), Some("gbk".to_string())).unwrap();
        let gbk = std::fs::read(&path).unwrap();
        assert_eq!(&gbk[..4], &[0xD6, 0xD0, 0xCE, 0xC4]);
        let opened = read_document(path_str.clone()).unwrap();
        assert_eq!(opened.encoding, "gbk");
        assert_eq!(opened.content, text);

        write_document(path_str.clone(), text.to_string(), Some("utf-16le".to_string())).unwrap();
        let opened = read_document(path_str.clone()).unwrap();
        assert_eq!(opened.encoding, "utf-16le");
        assert_eq!(opened.content, text);

        write_document(path_str.clone(), text.to_string(), Some("utf-8-bom".to_string())).unwrap();
        let opened = read_document(path_str).unwrap();
        assert_eq!(opened.encoding, "utf-8-bom");
        assert_eq!(opened.content, text);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
