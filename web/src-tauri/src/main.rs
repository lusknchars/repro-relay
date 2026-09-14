#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod repository;

use tauri::{
    Emitter,
    menu::{Menu, MenuItem, Submenu},
};

#[tauri::command]
async fn open_plow_latch() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Fixed application identity only. The webview cannot supply a command or URL.
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-b", "co.plow.domo-desktop"])
            .status()
            .map_err(|_| "Could not launch Plow Latch.".to_owned())?;
        if status.success() {
            Ok(())
        } else {
            Err("Install Plow Latch on this Mac before opening it.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err("Plow Latch requires a Mac.".into())
}

#[tauri::command]
async fn save_packet(content: String, name: String) -> Result<bool, String> {
    if content.len() > 2_000_000
        || name.len() > 120
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return Err("Invalid export name or packet size.".into());
    }
    let is_cost_report = name.ends_with(".json");
    let file = rfd::AsyncFileDialog::new()
        .set_title(if name == "repro-relay-plow-setup.md" {
            "Save Plow setup guide"
        } else if is_cost_report {
            "Export cost report"
        } else {
            "Export repair packet"
        })
        .set_file_name(name)
        .add_filter(
            if is_cost_report { "JSON" } else { "Markdown" },
            if is_cost_report { &["json"] } else { &["md"] },
        )
        .save_file()
        .await;
    let Some(file) = file else {
        return Ok(false);
    };
    file.write(content.as_bytes())
        .await
        .map_err(|_| "Could not write the selected file.".to_owned())?;
    Ok(true)
}
fn main() {
    tauri::Builder::default()
        .manage(repository::RepositoryState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .menu(|app| {
            let menu = Menu::default(app)?;
            let report = MenuItem::with_id(
                app,
                "new-report",
                "New report",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let find =
                MenuItem::with_id(app, "find-case", "Find a case", true, Some("CmdOrCtrl+K"))?;
            let connections =
                MenuItem::with_id(app, "connections", "Connections", true, Some("CmdOrCtrl+,"))?;
            let repository = MenuItem::with_id(
                app,
                "open-repository",
                "Open repository…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let tools = MenuItem::with_id(
                app,
                "repository-tools",
                "Repository tools",
                true,
                Some("CmdOrCtrl+J"),
            )?;
            menu.append(&Submenu::with_items(
                app,
                "Workspace",
                true,
                &[&repository, &tools, &report, &find, &connections],
            )?)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let command = event.id().as_ref();
            if matches!(
                command,
                "new-report" | "find-case" | "connections" | "repository-tools" | "open-repository"
            ) {
                let _ = app.emit_to("main", "workspace-command", command);
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_packet,
            open_plow_latch,
            repository::repository_status,
            repository::select_repository,
            repository::open_repository_terminal
        ])
        .run(tauri::generate_context!())
        .expect("Repro Relay could not start its desktop window");
}
