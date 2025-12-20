use std::io::Cursor;
use base64::Engine;
use image::ImageFormat;
use xcap::Monitor;
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl, WebviewWindow};

// 了解更多关于 Tauri 命令的信息：https://tauri.app/develop/calling-rust/
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
        // .transparent(true) // 由于编译错误注释掉
        .build()
        .map_err(|e| e.to_string())?;

        // 设置大小为当前显示器大小以模拟全屏而不使用系统全屏
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
    
    // 为下次截图重新创建窗口
    ensure_screenshot_window(app).await?;
    Ok(())
}

#[tauri::command]
async fn capture_fullscreen() -> Result<tauri::ipc::Response, String> {
    let start_time = std::time::Instant::now();
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::fs;

        // 使用 screencapture 命令行工具
        // -x: 静音
        // -m: 仅主显示器 (如果需要多显示器，可能需要更复杂的逻辑或不加 -m)
        // -C: 包含光标 (可选，这里不加)
        // 默认包含菜单栏
        
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join("xshot_capture.png");
        
        let output = Command::new("screencapture")
            .arg("-x")
            .arg("-m") // 仅截取主屏幕，如果需要截取所有屏幕，可以去掉这个参数，但处理起来会更复杂
            .arg(&temp_file)
            .output()
            .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

        if !output.status.success() {
            return Err(format!("screencapture failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        let bytes = fs::read(&temp_file).map_err(|e| format!("Failed to read capture file: {}", e))?;
        
        // 删除临时文件
        let _ = fs::remove_file(temp_file);

        println!("Capture finished in {:?}", start_time.elapsed());
        return Ok(tauri::ipc::Response::new(bytes));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        // 目前只捕获第一个显示器。
        // TODO: 支持多显示器或特定显示器选择。
        let monitor = monitors.first().ok_or("No monitor found")?;
        let image = monitor.capture_image().map_err(|e| e.to_string())?;

        let mut bytes: Vec<u8> = Vec::new();
        
        // 使用快速压缩以提高性能
        let encoder = image::codecs::png::PngEncoder::new_with_quality(
            &mut bytes,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Paeth,
        );

        encoder.write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ColorType::Rgba8.into()
        ).map_err(|e| e.to_string())?;

        println!("Capture finished in {:?}", start_time.elapsed());
        Ok(tauri::ipc::Response::new(bytes))
    }
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
