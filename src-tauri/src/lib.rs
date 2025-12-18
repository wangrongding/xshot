use std::io::Cursor;
use base64::Engine;
use image::ImageFormat;
use xcap::Monitor;
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl, WebviewWindow};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

#[tauri::command]
fn open_screenshot_devtools(app: AppHandle) {
    if let Some(window) = app.get_webview_window("screenshot_window") {
        window.open_devtools();
    }
}

#[tauri::command]
async fn ensure_screenshot_window(app: AppHandle) -> Result<(), String> {
    let label = "screenshot_window";
    
    if let Some(_) = app.get_webview_window(label) {
        println!("Window already exists");
    } else {
        println!("Creating new screenshot window...");
        let window = WebviewWindowBuilder::new(
            &app,
            label,
            WebviewUrl::App("/screenshot".into())
        )
        .title("Screenshot")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // .transparent(true) // Commented out due to compilation error
        .build()
        .map_err(|e| e.to_string())?;

        // Set size to current monitor size to simulate fullscreen without using system fullscreen
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let position = monitor.position();
            window.set_position(*position).map_err(|e: tauri::Error| e.to_string())?;
            window.set_size(*size).map_err(|e: tauri::Error| e.to_string())?;
        } else {
            println!("Failed to get current monitor, setting default size");
            window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 800.0, height: 600.0 })).unwrap();
        }
        
        println!("Screenshot window created successfully");
    }
    Ok(())
}

#[tauri::command]
async fn finish_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screenshot_window") {
        window.close().map_err(|e| e.to_string())?;
    }
    
    // Re-create the window for the next time
    ensure_screenshot_window(app).await?;
    Ok(())
}

#[tauri::command]
fn capture_fullscreen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    // For now, just capture the first monitor. 
    // TODO: Support multiple monitors or specific monitor selection.
    let monitor = monitors.first().ok_or("No monitor found")?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    let mut bytes: Vec<u8> = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_string = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", base64_string))
}

#[tauri::command]
fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.first().ok_or("No monitor found")?;
    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    // Crop the image
    // Note: xcap returns a RgbaImage (which is a DynamicImage compatible type or can be converted)
    // We need to convert to DynamicImage to use crop_imm easily or use sub_image
    let mut dynamic_image = image::DynamicImage::ImageRgba8(image);
    let cropped = dynamic_image.crop(x, y, width, height);

    let mut bytes: Vec<u8> = Vec::new();
    cropped
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let base64_string = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", base64_string))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet, 
            capture_fullscreen, 
            capture_region,
            ensure_screenshot_window,
            finish_capture,
            open_devtools,
            open_screenshot_devtools
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                ensure_screenshot_window(handle).await.unwrap();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
