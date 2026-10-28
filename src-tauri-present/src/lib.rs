use std::path::Path;
use std::sync::Mutex;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

/// Document paths the OS asked us to open (double-click, "Open with", command line) that the
/// frontend has not picked up yet. The frontend drains this on start-up and on each event.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

const EXTENSIONS: [&str; 3] = ["pptx", "md", "txt"];

fn is_deck(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

#[tauri::command]
fn take_opened_files(state: State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Reads a document the OS handed to us. Limited to the types the editor opens, so the webview cannot use this to read arbitrary files.
#[tauri::command]
fn read_doc(path: String) -> Result<Response, String> {
    let p = Path::new(&path);
    if !is_deck(p) {
        return Err("That type of file cannot be opened this way".into());
    }
    std::fs::read(p).map(Response::new).map_err(|e| format!("{e}"))
}

fn queue(app: &AppHandle, paths: impl IntoIterator<Item = String>) {
    let paths: Vec<String> = paths.into_iter().filter(|p| is_deck(Path::new(p))).collect();
    if paths.is_empty() {
        return;
    }
    app.state::<Pending>().0.lock().unwrap().extend(paths);
    let _ = app.emit("open-files", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Pending::default())
        .invoke_handler(tauri::generate_handler![take_opened_files, read_doc])
        .setup(|app| {
            // Windows/Linux pass the file as a command-line argument.
            queue(app.handle(), std::env::args().skip(1));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kwiiva Present");

    app.run(|_handle, _event| {
        // macOS delivers "Open with…" and double-clicks as an event rather than an argument.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            queue(
                _handle,
                urls.iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned()),
            );
        }
    });
}
