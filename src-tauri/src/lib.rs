#[cfg(not(target_os = "macos"))]
use image::ImageFormat;
use serde::Serialize;
#[cfg(not(target_os = "macos"))]
use std::io::Cursor;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use xcap::{Monitor, Window};

#[derive(Debug, Serialize)]
struct CaptureWindowRegion {
    id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    monitor_width: f64,
    monitor_height: f64,
    is_fullscreen_like: bool,
    is_overlay_candidate: bool,
    is_focused: bool,
    title: String,
    app_name: String,
}

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

    let window = if let Some(window) = app.get_webview_window(label) {
        // println!("Window already exists");
        window
    } else {
        println!("Creating new screenshot window...");
        let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::App("/screenshot".into()))
            .title("Screenshot")
            .visible(false)
            .decorations(false)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .build()
            .map_err(|e| e.to_string())?;

        println!("Screenshot window created successfully");
        window
    };

    // 确保截图窗口大小和位置正确（尤其是在多显示器环境下）
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::rc::Retained;
        use objc2_app_kit::{NSEvent, NSScreen, NSWindow, NSWindowCollectionBehavior};
        use objc2_foundation::MainThreadMarker;

        let window_handle = window.clone();
        let _ = app.run_on_main_thread(move || {
            let _mtm = MainThreadMarker::new_unchecked();

            // 获取鼠标位置
            let mouse_loc = NSEvent::mouseLocation();
            let screens = NSScreen::screens(_mtm);
            let count = screens.count();
            let mut target_screen = None;

            // 查找鼠标所在的屏幕
            for i in 0..count {
                let screen = screens.objectAtIndex(i);
                let frame = screen.frame();
                if mouse_loc.x >= frame.origin.x
                    && mouse_loc.x < frame.origin.x + frame.size.width
                    && mouse_loc.y >= frame.origin.y
                    && mouse_loc.y < frame.origin.y + frame.size.height
                {
                    target_screen = Some(screen);
                    break;
                }
            }

            // 如果没找到，默认使用第一个屏幕
            let screen = target_screen.unwrap_or_else(|| screens.objectAtIndex(0));
            let frame = screen.frame();

            let ns_window = window_handle.ns_window().unwrap() as *mut std::ffi::c_void;
            // 转换为 *mut NSWindow 并保留它
            let ns_window = Retained::from_raw(ns_window as *mut NSWindow).unwrap();

            // 移动窗口到目标屏幕并设置大小
            ns_window.setFrame_display(frame, true);

            // 设置层级为 NSStatusWindowLevel (25)
            ns_window.setLevel(25);

            let behavior = ns_window.collectionBehavior();
            ns_window.setCollectionBehavior(
                behavior
                    | NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );

            // 防止 Retained 包装器在超出作用域时释放窗口
            // 因为 Tauri 管理窗口生命周期
            let _ = Retained::into_raw(ns_window);
        });
    }

    // 对于非 macOS 系统，或者作为 macOS 的补充（如果上面的 unsafe 代码块没有覆盖所有情况）
    // 我们仍然尝试使用 Tauri 的 API 来设置大小，但这可能不会移动窗口到正确的屏幕
    #[cfg(not(target_os = "macos"))]
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();
        let _ = window.set_position(*position);
        let _ = window.set_size(*size);
    }

    Ok(())
}

#[tauri::command]
async fn finish_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screenshot_window") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn capture_fullscreen(app: AppHandle) -> Result<tauri::ipc::Response, String> {
    // 确保窗口在正确的屏幕上
    ensure_screenshot_window(app.clone()).await?;

    let start_time = std::time::Instant::now();
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

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
            return Err(format!(
                "screencapture failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let bytes =
            fs::read(&temp_file).map_err(|e| format!("Failed to read capture file: {}", e))?;

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

        encoder
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ColorType::Rgba8.into(),
            )
            .map_err(|e| e.to_string())?;

        println!("Capture finished in {:?}", start_time.elapsed());
        Ok(tauri::ipc::Response::new(bytes))
    }
}

#[tauri::command]
async fn list_capture_windows() -> Result<Vec<CaptureWindowRegion>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    let target_monitor = monitors
        .iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or("No monitor found")?;

    #[cfg(not(target_os = "macos"))]
    let target_monitor = monitors.first().ok_or("No monitor found")?;

    let monitor_x = target_monitor.x().map_err(|e| e.to_string())?;
    let monitor_y = target_monitor.y().map_err(|e| e.to_string())?;
    let monitor_width = target_monitor.width().map_err(|e| e.to_string())? as i32;
    let monitor_height = target_monitor.height().map_err(|e| e.to_string())? as i32;
    let monitor_right = monitor_x + monitor_width;
    let monitor_bottom = monitor_y + monitor_height;
    let current_pid = std::process::id();
    let ignored_apps = [
        "Dock",
        "SystemUIServer",
        "Window Server",
        "Control Center",
        "Notification Center",
        "xshot",
        "程序坞",
        "控制中心",
        "通知中心",
    ];

    let windows = Window::all().map_err(|e| e.to_string())?;
    let mut regions = Vec::new();

    for window in windows {
        let id = match window.id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        let pid = window.pid().unwrap_or_default();
        if pid == current_pid {
            continue;
        }
        if window.is_minimized().unwrap_or(false) {
            continue;
        }

        let app_name = window.app_name().unwrap_or_default();
        let title = window.title().unwrap_or_default();
        if ignored_apps
            .iter()
            .any(|ignored| app_name.eq_ignore_ascii_case(ignored))
        {
            continue;
        }

        let x = match window.x() {
            Ok(x) => x,
            Err(_) => continue,
        };
        let y = match window.y() {
            Ok(y) => y,
            Err(_) => continue,
        };
        let width = match window.width() {
            Ok(width) => width as i32,
            Err(_) => continue,
        };
        let height = match window.height() {
            Ok(height) => height as i32,
            Err(_) => continue,
        };

        if width < 40 || height < 40 {
            continue;
        }

        let left = x.max(monitor_x);
        let top = y.max(monitor_y);
        let right = (x + width).min(monitor_right);
        let bottom = (y + height).min(monitor_bottom);
        let clipped_width = right - left;
        let clipped_height = bottom - top;

        if clipped_width < 40 || clipped_height < 40 {
            continue;
        }

        let monitor_area = monitor_width as f64 * monitor_height as f64;
        let window_area = clipped_width as f64 * clipped_height as f64;
        let covers_whole_monitor = window_area / monitor_area > 0.92
            && clipped_width as f64 >= monitor_width as f64 * 0.96
            && clipped_height as f64 >= monitor_height as f64 * 0.92;
        let is_focused = window.is_focused().unwrap_or(false);
        let is_overlay_candidate = covers_whole_monitor && title.trim().is_empty() && !is_focused;

        regions.push(CaptureWindowRegion {
            id,
            x: (left - monitor_x) as f64,
            y: (top - monitor_y) as f64,
            width: clipped_width as f64,
            height: clipped_height as f64,
            monitor_width: monitor_width as f64,
            monitor_height: monitor_height as f64,
            is_fullscreen_like: covers_whole_monitor,
            is_overlay_candidate,
            is_focused,
            title,
            app_name,
        });
    }

    Ok(regions)
}

#[tauri::command]
async fn copy_to_clipboard(app: AppHandle, blob_data: Vec<u8>) -> Result<(), String> {
    // Decode the image from memory (detects format automatically, e.g. PNG)
    let img = image::load_from_memory(&blob_data)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let width = img.width();
    let height = img.height();
    let rgba_img = img.to_rgba8();
    let rgba_bytes = rgba_img.as_raw();

    let image = tauri::image::Image::new(rgba_bytes, width, height);

    // 写入剪切板
    app.clipboard()
        .write_image(&image)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn save_to_downloads(blob_data: Vec<u8>) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    let downloads_dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .map(|home| home.join("Downloads"))
        .filter(|path| path.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = downloads_dir.join(format!("xshot-{}.png", timestamp));

    fs::write(&path, blob_data).map_err(|e| format!("Failed to save screenshot: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            capture_fullscreen,
            list_capture_windows,
            copy_to_clipboard,
            save_to_downloads,
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

            let capture_i = MenuItem::with_id(app, "capture", "Capture", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture_i, &show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "capture" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = ensure_screenshot_window(app.clone()).await {
                                eprintln!("Failed to prepare screenshot window: {}", error);
                                return;
                            }
                            if let Err(error) = app.emit("start-capture", ()) {
                                eprintln!("Failed to start capture: {}", error);
                            }
                        });
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
