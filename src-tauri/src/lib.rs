use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

static TAB_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct Tabs {
  ids: Vec<String>,
  active: Option<String>,
  urls: std::collections::HashMap<String, String>,
}

#[derive(Clone, Serialize)]
struct TabState {
  id: String,
  url: String,
  title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabEvent {
  r#type: String,
  tabs: Vec<TabState>,
  active_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct SuggestItem {
  url: String,
  title: String,
  snippet: String,
  source: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  image: Option<String>,
}

#[derive(Clone, Serialize)]
struct SuggestOut {
  keywords: Vec<String>,
  results: Vec<SuggestItem>,
}

#[derive(Clone, Serialize)]
struct PreviewOut {
  url: String,
  title: String,
  description: String,
  image: String,
  video: String,
  kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractOut {
  url: String,
  title: String,
  names: Vec<String>,
  media_meta: Vec<String>,
  media_links: Vec<String>,
}

fn client() -> reqwest::blocking::Client {
  reqwest::blocking::Client::builder()
    .user_agent("Mozilla/5.0 Scout/0.2")
    .redirect(reqwest::redirect::Policy::limited(8))
    .timeout(std::time::Duration::from_secs(12))
    .build()
    .expect("client")
}

fn decode(s: &str) -> String {
  s.replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
}

fn strip_tags(s: &str) -> String {
  let re = regex::Regex::new(r"<[^>]+>").unwrap();
  decode(&re.replace_all(s, "")).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn youtube_thumb(url: &str) -> String {
  if let Ok(u) = url::Url::parse(url) {
    if u.host_str().unwrap_or("").contains("youtu.be") {
      if let Some(id) = u.path_segments().and_then(|mut s| s.next()) {
        if !id.is_empty() {
          return format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg");
        }
      }
    }
    if u.host_str().unwrap_or("").contains("youtube.com") {
      if let Some(id) = u.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.into_owned()) {
        if !id.is_empty() {
          return format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg");
        }
      }
    }
  }
  String::new()
}

fn pick(html: &str, re: &str) -> String {
  regex::Regex::new(re)
    .ok()
    .and_then(|r| r.captures(html).and_then(|c| c.get(1).map(|m| decode(m.as_str()))))
    .unwrap_or_default()
}

fn emit_tabs(app: &AppHandle, state: &Tabs) {
  let tabs: Vec<TabState> = state
    .ids
    .iter()
    .map(|id| TabState {
      id: id.clone(),
      url: state.urls.get(id).cloned().unwrap_or_default(),
      title: state.urls.get(id).cloned().unwrap_or_else(|| "Tab".into()),
    })
    .collect();
  let _ = app.emit(
    "tab:event",
    TabEvent {
      r#type: "list".into(),
      tabs,
      active_id: state.active.clone(),
    },
  );
}

fn normalize_url(raw: &str) -> String {
  let t = raw.trim();
  if t.is_empty() {
    return "https://en.wikipedia.org/wiki/Main_Page".into();
  }
  if t.contains("://") {
    return t.into();
  }
  if t.contains(' ') || !t.contains('.') {
    return format!("https://duckduckgo.com/?q={}", urlencoding_lite(t));
  }
  format!("https://{t}")
}

fn urlencoding_lite(s: &str) -> String {
  s.bytes()
    .flat_map(|b| {
      if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
        vec![b as char]
      } else if b == b' ' {
        vec!['+']
      } else {
        format!("%{b:02X}").chars().collect()
      }
    })
    .collect()
}

#[tauri::command]
fn tab_create(app: AppHandle, url: Option<String>, state: tauri::State<Mutex<Tabs>>) -> Result<String, String> {
  let id = TAB_SEQ.fetch_add(1, Ordering::Relaxed).to_string();
  let href = normalize_url(&url.unwrap_or_default());
  let label = format!("tab-{id}");
  WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(href.parse().map_err(|e| format!("{e}"))?))
    .title("Scout tab")
    .inner_size(960.0, 640.0)
    .build()
    .map_err(|e| e.to_string())?;
  let mut tabs = state.lock().map_err(|e| e.to_string())?;
  tabs.ids.push(id.clone());
  tabs.active = Some(id.clone());
  tabs.urls.insert(id.clone(), href);
  emit_tabs(&app, &tabs);
  Ok(id)
}

#[tauri::command]
fn tab_close(app: AppHandle, id: String, state: tauri::State<Mutex<Tabs>>) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    let _ = w.close();
  }
  let mut tabs = state.lock().map_err(|e| e.to_string())?;
  tabs.ids.retain(|x| x != &id);
  tabs.urls.remove(&id);
  if tabs.active.as_deref() == Some(&id) {
    tabs.active = tabs.ids.last().cloned();
  }
  emit_tabs(&app, &tabs);
  Ok(())
}

#[tauri::command]
fn tab_activate(app: AppHandle, id: String, state: tauri::State<Mutex<Tabs>>) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    let _ = w.set_focus();
  }
  let mut tabs = state.lock().map_err(|e| e.to_string())?;
  tabs.active = Some(id);
  emit_tabs(&app, &tabs);
  Ok(())
}

#[tauri::command]
fn tab_navigate(app: AppHandle, id: String, url: String, state: tauri::State<Mutex<Tabs>>) -> Result<(), String> {
  let href = normalize_url(&url);
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    w.navigate(href.parse().map_err(|e| format!("{e}"))?).map_err(|e| e.to_string())?;
  }
  let mut tabs = state.lock().map_err(|e| e.to_string())?;
  tabs.urls.insert(id, href);
  emit_tabs(&app, &tabs);
  Ok(())
}

#[tauri::command]
fn tab_reload(app: AppHandle, id: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    let _ = w.eval("location.reload()");
  }
  Ok(())
}

#[tauri::command]
fn tab_back(app: AppHandle, id: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    let _ = w.eval("history.back()");
  }
  Ok(())
}

#[tauri::command]
fn tab_forward(app: AppHandle, id: String) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(&format!("tab-{id}")) {
    let _ = w.eval("history.forward()");
  }
  Ok(())
}

#[tauri::command]
fn layout_set(_mode: String) -> Result<String, String> {
  Ok(_mode)
}

#[tauri::command]
fn layout_sidebar(_w: f64) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
fn page_extract(id: String, state: tauri::State<Mutex<Tabs>>) -> Result<ExtractOut, String> {
  let url = {
    let tabs = state.lock().map_err(|e| e.to_string())?;
    tabs.urls.get(&id).cloned().unwrap_or_default()
  };
  if url.is_empty() {
    return Ok(ExtractOut {
      url,
      title: String::new(),
      names: vec![],
      media_meta: vec![],
      media_links: vec![],
    });
  }
  let html = client().get(&url).send().and_then(|r| r.text()).unwrap_or_default();
  let title = pick(&html, r"(?is)<title[^>]*>(.*?)</title>");
  let og = pick(&html, r#"(?i)property=["']og:title["'][^>]+content=["']([^"']+)"#);
  let author = pick(&html, r#"(?i)name=["']author["'][^>]+content=["']([^"']+)"#);
  let mut names = vec![];
  for raw in [&og, &author, &title] {
    for cap in regex::Regex::new(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b")
      .unwrap()
      .captures_iter(raw)
    {
      names.push(cap[0].to_string());
    }
  }
  let mut media_meta = vec![];
  for re in [
    r#"(?i)<img[^>]+alt=["']([^"']{3,})["']"#,
    r#"(?i)<video[^>]+title=["']([^"']{3,})["']"#,
    r#"(?is)<figcaption[^>]*>(.*?)</figcaption>"#,
  ] {
    if let Ok(rx) = regex::Regex::new(re) {
      for cap in rx.captures_iter(&html).take(8) {
        let t = strip_tags(&cap[1]);
        if t.len() > 2 {
          media_meta.push(t.chars().take(160).collect());
        }
      }
    }
  }
  let mut media_links = vec![];
  if let Ok(rx) = regex::Regex::new(r#"(?i)href=["']([^"']+\.(?:mp4|webm|jpg|jpeg|png|webp|gif|mp3))["']"#) {
    for cap in rx.captures_iter(&html).take(8) {
      media_links.push(cap[1].to_string());
    }
  }
  names.truncate(12);
  media_meta.truncate(12);
  Ok(ExtractOut {
    url,
    title,
    names,
    media_meta,
    media_links,
  })
}

#[tauri::command]
fn suggest_search(keywords: Vec<String>, exclude_url: Option<String>) -> Result<SuggestOut, String> {
  let q = keywords.join(" ");
  if q.trim().is_empty() {
    return Ok(SuggestOut {
      keywords,
      results: vec![],
    });
  }
  let mut results = vec![];
  if let Ok(res) = client()
    .get("https://en.wikipedia.org/w/api.php")
    .query(&[
      ("action", "query"),
      ("generator", "search"),
      ("gsrsearch", &q),
      ("gsrlimit", "5"),
      ("prop", "pageimages|extracts|info"),
      ("inprop", "url"),
      ("exintro", "1"),
      ("explaintext", "1"),
      ("pithumbsize", "640"),
      ("format", "json"),
    ])
    .send()
    .and_then(|r| r.text())
  {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&res) {
      if let Some(pages) = v["query"]["pages"].as_object() {
        for p in pages.values() {
          results.push(SuggestItem {
            url: p["fullurl"].as_str().unwrap_or("").into(),
            title: p["title"].as_str().unwrap_or("").into(),
            snippet: p["extract"].as_str().unwrap_or("").chars().take(220).collect(),
            source: "wiki".into(),
            image: p["thumbnail"]["source"].as_str().map(|s| s.to_string()),
          });
        }
      }
    }
  }
  if let Ok(html) = client()
    .get("https://html.duckduckgo.com/html/")
    .query(&[("q", q.as_str())])
    .send()
    .and_then(|r| r.text())
  {
    let re = regex::Regex::new(
      r#"(?is)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
    )
    .unwrap();
    for cap in re.captures_iter(&html).take(8) {
      let mut href = decode(&cap[1]);
      if let Ok(u) = url::Url::parse(&href) {
        if u.path() == "/l/" {
          if let Some((_, v)) = u.query_pairs().find(|(k, _)| k == "uddg") {
            href = v.into_owned();
          }
        }
      }
      results.push(SuggestItem {
        url: href,
        title: strip_tags(&cap[2]),
        snippet: String::new(),
        source: "search".into(),
        image: None,
      });
    }
  }
  let skip = exclude_url.unwrap_or_default().trim_end_matches('/').to_string();
  results.retain(|r| !r.url.is_empty() && r.url.trim_end_matches('/') != skip);
  results.truncate(12);
  Ok(SuggestOut { keywords, results })
}

#[tauri::command]
fn suggest_preview(url: String, _keywords: Option<Vec<String>>) -> Result<PreviewOut, String> {
  let yt = youtube_thumb(&url);
  if url.ends_with(".mp4") || url.ends_with(".webm") {
    return Ok(PreviewOut {
      url: url.clone(),
      title: url,
      description: String::new(),
      image: String::new(),
      video: String::new(),
      kind: "video".into(),
    });
  }
  let html = client().get(&url).send().and_then(|r| r.text()).unwrap_or_default();
  let image = {
    let og = pick(&html, r#"(?i)property=["']og:image["'][^>]+content=["']([^"']+)"#);
    if !og.is_empty() {
      og
    } else {
      let img = pick(&html, r#"(?i)<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']"#);
      if !img.is_empty() {
        img
      } else {
        yt
      }
    }
  };
  Ok(PreviewOut {
    url: url.clone(),
    title: {
      let t = pick(&html, r#"(?i)property=["']og:title["'][^>]+content=["']([^"']+)"#);
      if t.is_empty() {
        pick(&html, r"(?is)<title[^>]*>(.*?)</title>")
      } else {
        t
      }
    },
    description: pick(&html, r#"(?i)property=["']og:description["'][^>]+content=["']([^"']+)"#),
    image,
    video: pick(&html, r#"(?i)property=["']og:video["'][^>]+content=["']([^"']+)"#),
    kind: "image".into(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(Mutex::new(Tabs::default()))
    .invoke_handler(tauri::generate_handler![
      tab_create,
      tab_close,
      tab_activate,
      tab_navigate,
      tab_reload,
      tab_back,
      tab_forward,
      layout_set,
      layout_sidebar,
      page_extract,
      suggest_search,
      suggest_preview
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      let _ = tab_create(handle, Some("https://en.wikipedia.org/wiki/Main_Page".into()), app.state());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Scout");
}
