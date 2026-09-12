#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    let file = rfd::AsyncFileDialog::new()
        .set_title("Export repair packet")
        .set_file_name(name)
        .add_filter("Markdown", &["md"])
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_packet])
        .run(tauri::generate_context!())
        .expect("Repro Relay could not start its desktop window");
}
