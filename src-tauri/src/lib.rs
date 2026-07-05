#[cfg(not(target_os = "macos"))]
use image::ImageEncoder;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use xcap::{Monitor, Window};

#[derive(Debug, Serialize)]
struct CaptureWindowRegion {
    id: u32,
    pid: u32,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacosPermissionStatus {
    macos: bool,
    accessibility: bool,
    event_posting: bool,
    screen_recording: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureScrollEvent {
    x: f64,
    y: f64,
    delta_x: f64,
    delta_y: f64,
}

#[cfg(target_os = "macos")]
thread_local! {
    static LONG_CAPTURE_SCROLL_TAP: std::cell::RefCell<Option<core_graphics::event::CGEventTap<'static>>> =
        const { std::cell::RefCell::new(None) };
    static LONG_CAPTURE_SCROLL_SOURCE: std::cell::RefCell<Option<core_foundation::runloop::CFRunLoopSource>> =
        const { std::cell::RefCell::new(None) };
}

// 了解更多关于 Tauri 命令的信息：https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(window: WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();

    #[cfg(not(debug_assertions))]
    let _ = window;
}

#[tauri::command]
fn open_screenshot_devtools(app: AppHandle) {
    #[cfg(debug_assertions)]
    {
        if let Some(window) = app.get_webview_window("screenshot_window") {
            window.open_devtools();
        }
    }

    #[cfg(not(debug_assertions))]
    let _ = app;
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
    #[cfg(target_os = "macos")]
    let _ = stop_long_capture_scroll_monitor(app.clone()).await;
    #[cfg(target_os = "macos")]
    let _ = set_screenshot_window_ignores_mouse_events(&app, false);

    if let Some(window) = app.get_webview_window("screenshot_window") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn set_dock_icon_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let should_restore_main_window = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };

        app.set_activation_policy(policy)
            .map_err(|error| error.to_string())?;
    }

    if should_restore_main_window {
        show_main_window(&app);

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(120));
            show_main_window(&app_handle);
        });
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);

    Ok(())
}

#[tauri::command]
async fn capture_fullscreen(_app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let start_time = std::time::Instant::now();
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!(
            "xshot_capture_screen_{}_{}.png",
            std::process::id(),
            timestamp
        ));
        let screenshot_window = _app
            .get_webview_window("screenshot_window")
            .ok_or("Screenshot window not found")?;
        let scale_factor = screenshot_window
            .scale_factor()
            .map_err(|e| e.to_string())?;
        let position = screenshot_window
            .inner_position()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale_factor);
        let size = screenshot_window
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale_factor);
        let rect = format!(
            "{},{},{},{}",
            position.x.round() as i64,
            position.y.round() as i64,
            size.width.round().max(1.0) as i64,
            size.height.round().max(1.0) as i64
        );

        let output = Command::new("screencapture")
            .arg("-x")
            .arg("-R")
            .arg(&rect)
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

        println!(
            "Capture screen rect {} finished in {:?}",
            rect,
            start_time.elapsed()
        );
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
async fn capture_screen_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<tauri::ipc::Response, String> {
    let start_time = std::time::Instant::now();

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::Command;

        if width <= 0.0 || height <= 0.0 {
            return Err("Invalid capture rectangle".into());
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!(
            "xshot_capture_rect_{}_{}.png",
            std::process::id(),
            timestamp
        ));
        let rect = format!(
            "{},{},{},{}",
            x.round() as i64,
            y.round() as i64,
            width.round().max(1.0) as i64,
            height.round().max(1.0) as i64
        );

        let output = Command::new("screencapture")
            .arg("-x")
            .arg("-R")
            .arg(&rect)
            .arg(&temp_file)
            .output()
            .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

        if !output.status.success() {
            let _ = fs::remove_file(&temp_file);
            return Err(format!(
                "screencapture rect failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let bytes =
            fs::read(&temp_file).map_err(|e| format!("Failed to read capture file: {}", e))?;
        let _ = fs::remove_file(temp_file);

        println!(
            "Capture rect {} finished in {:?}",
            rect,
            start_time.elapsed()
        );
        Ok(tauri::ipc::Response::new(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y, width, height);
        Err("Rectangle capture is only implemented on macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn screenshot_window_number(app: &AppHandle) -> Result<u32, String> {
    use objc2_app_kit::NSWindow;
    use std::sync::mpsc;
    use std::time::Duration;

    let window = app
        .get_webview_window("screenshot_window")
        .ok_or("Screenshot window not found")?;
    let (sender, receiver) = mpsc::channel();

    app.run_on_main_thread(move || {
        let result = unsafe {
            match window.ns_window() {
                Ok(ns_window) => {
                    let ns_window = &*(ns_window as *mut NSWindow);
                    Ok(ns_window.windowNumber().max(0) as u32)
                }
                Err(error) => Err(error.to_string()),
            }
        };
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(Duration::from_millis(250))
        .map_err(|_| "Timed out while reading screenshot window number".to_string())?
}

#[cfg(target_os = "macos")]
fn encode_cg_image_to_png_bytes(image: &core_graphics::image::CGImage) -> Result<Vec<u8>, String> {
    use core_foundation::base::{kCFAllocatorDefault, CFRelease, TCFType};
    use core_foundation::data::{CFDataCreateMutable, CFDataGetBytePtr, CFDataGetLength};
    use core_foundation::string::CFString;
    use foreign_types::ForeignTypeRef;
    use std::ffi::c_void;
    use std::ptr;

    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return Err("Captured image is empty".into());
    }

    type CGImageDestinationRef = *mut c_void;

    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        fn CGImageDestinationCreateWithData(
            data: core_foundation::data::CFMutableDataRef,
            type_identifier: core_foundation::string::CFStringRef,
            count: usize,
            options: *const c_void,
        ) -> CGImageDestinationRef;
        fn CGImageDestinationAddImage(
            destination: CGImageDestinationRef,
            image: core_graphics::sys::CGImageRef,
            properties: *const c_void,
        );
        fn CGImageDestinationFinalize(destination: CGImageDestinationRef) -> bool;
    }

    unsafe {
        let data = CFDataCreateMutable(kCFAllocatorDefault, 0);
        if data.is_null() {
            return Err("Failed to create PNG data buffer".into());
        }

        let png_type = CFString::new("public.png");
        let destination =
            CGImageDestinationCreateWithData(data, png_type.as_concrete_TypeRef(), 1, ptr::null());
        if destination.is_null() {
            CFRelease(data as *const c_void);
            return Err("Failed to create PNG image destination".into());
        }

        CGImageDestinationAddImage(destination, image.as_ptr(), ptr::null());
        let finalized = CGImageDestinationFinalize(destination);
        CFRelease(destination as *const c_void);

        if !finalized {
            CFRelease(data as *const c_void);
            return Err("Failed to finalize PNG image destination".into());
        }

        let length = CFDataGetLength(data);
        let bytes_ptr = CFDataGetBytePtr(data);
        if length <= 0 || bytes_ptr.is_null() {
            CFRelease(data as *const c_void);
            return Err("Encoded PNG data is empty".into());
        }

        let bytes = std::slice::from_raw_parts(bytes_ptr, length as usize).to_vec();
        CFRelease(data as *const c_void);
        Ok(bytes)
    }
}

#[tauri::command]
async fn capture_screen_rect_below_screenshot_window(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<tauri::ipc::Response, String> {
    let start_time = std::time::Instant::now();

    #[cfg(target_os = "macos")]
    {
        use core_graphics::geometry::{CGPoint, CGRect, CGSize};
        use core_graphics::window::{
            create_image, kCGWindowImageBoundsIgnoreFraming, kCGWindowListOptionOnScreenBelowWindow,
        };

        if width <= 0.0 || height <= 0.0 {
            return Err("Invalid capture rectangle".into());
        }

        let window_number = screenshot_window_number(&app)?;
        let rect = CGRect::new(
            &CGPoint::new(x.round(), y.round()),
            &CGSize::new(width.round().max(1.0), height.round().max(1.0)),
        );

        let image = create_image(
            rect,
            kCGWindowListOptionOnScreenBelowWindow,
            window_number,
            kCGWindowImageBoundsIgnoreFraming,
        )
        .ok_or("Failed to capture screen below screenshot window")?;
        let bytes = encode_cg_image_to_png_bytes(&image)?;

        println!(
            "Capture below-window rect {},{},{},{} finished in {:?}",
            x.round() as i64,
            y.round() as i64,
            width.round().max(1.0) as i64,
            height.round().max(1.0) as i64,
            start_time.elapsed()
        );
        Ok(tauri::ipc::Response::new(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, x, y, width, height);
        Err("Below-window rectangle capture is only implemented on macOS".into())
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
            pid,
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
async fn save_to_downloads(
    blob_data: Vec<u8>,
    directory: Option<String>,
) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    let configured_dir = directory
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_dir());
    let downloads_dir = configured_dir
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
                .map(|home| home.join("Downloads"))
                .filter(|path| path.is_dir())
        })
        .unwrap_or_else(std::env::temp_dir);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = downloads_dir.join(format!("xshot-{}.png", timestamp));

    fs::write(&path, blob_data).map_err(|e| format!("Failed to save screenshot: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

fn macos_accessibility_trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            #[link(name = "ApplicationServices", kind = "framework")]
            unsafe extern "C" {
                fn AXIsProcessTrusted() -> u8;
            }

            AXIsProcessTrusted() != 0
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn macos_screen_recording_authorized() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            #[link(name = "CoreGraphics", kind = "framework")]
            unsafe extern "C" {
                fn CGPreflightScreenCaptureAccess() -> bool;
            }

            CGPreflightScreenCaptureAccess()
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn macos_event_posting_authorized() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            #[link(name = "CoreGraphics", kind = "framework")]
            unsafe extern "C" {
                fn CGPreflightPostEventAccess() -> bool;
            }

            CGPreflightPostEventAccess()
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn macos_request_accessibility_trust() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            use core_foundation::base::TCFType;
            use core_foundation::boolean::CFBoolean;
            use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
            use core_foundation::string::{CFString, CFStringRef};

            #[link(name = "ApplicationServices", kind = "framework")]
            unsafe extern "C" {
                static kAXTrustedCheckOptionPrompt: CFStringRef;
                fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
            }

            let prompt_key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let prompt_value = CFBoolean::true_value();
            let options: CFDictionary<CFString, CFBoolean> =
                CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);

            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn macos_request_event_posting_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            #[link(name = "CoreGraphics", kind = "framework")]
            unsafe extern "C" {
                fn CGRequestPostEventAccess() -> bool;
            }

            CGRequestPostEventAccess()
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn macos_request_screen_recording_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            #[link(name = "CoreGraphics", kind = "framework")]
            unsafe extern "C" {
                fn CGRequestScreenCaptureAccess() -> bool;
            }

            CGRequestScreenCaptureAccess()
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[cfg(target_os = "macos")]
fn set_screenshot_window_ignores_mouse_events(
    app: &AppHandle,
    ignores_mouse_events: bool,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use std::sync::mpsc;
    use std::time::Duration;

    let window = app
        .get_webview_window("screenshot_window")
        .ok_or("Screenshot window not found")?;
    let (sender, receiver) = mpsc::channel();

    app.run_on_main_thread(move || {
        let result = unsafe {
            match window.ns_window() {
                Ok(ns_window) => {
                    let ns_window = &*(ns_window as *mut NSWindow);
                    ns_window.setIgnoresMouseEvents(ignores_mouse_events);
                    Ok(())
                }
                Err(error) => Err(error.to_string()),
            }
        };
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(Duration::from_millis(250))
        .map_err(|_| "Timed out while updating screenshot mouse passthrough".to_string())?
}

#[tauri::command]
async fn is_accessibility_trusted() -> bool {
    macos_accessibility_trusted() && macos_event_posting_authorized()
}

#[tauri::command]
async fn get_macos_permissions() -> MacosPermissionStatus {
    MacosPermissionStatus {
        macos: cfg!(target_os = "macos"),
        accessibility: macos_accessibility_trusted(),
        event_posting: macos_event_posting_authorized(),
        screen_recording: macos_screen_recording_authorized(),
    }
}

#[tauri::command]
async fn open_macos_permission_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match kind.as_str() {
            "accessibility" => {
                let _ = macos_request_accessibility_trust();
                let _ = macos_request_event_posting_access();
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "screenRecording" => {
                let _ = macos_request_screen_recording_access();
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            _ => return Err(format!("Unknown permission kind: {}", kind)),
        };

        let status = std::process::Command::new("open")
            .arg(url)
            .status()
            .map_err(|error| format!("Failed to open System Settings: {}", error))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "System Settings exited with status: {}",
                status
                    .code()
                    .map_or_else(|| "unknown".to_string(), |code| code.to_string())
            ))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Ok(())
    }
}

#[tauri::command]
async fn post_scroll_wheel(
    app: AppHandle,
    x: f64,
    y: f64,
    delta_x: i32,
    delta_y: i32,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::ffi::c_void;

        if !macos_event_posting_authorized() {
            return Err("Event posting permission is not granted".into());
        }

        #[repr(C)]
        struct CGPoint {
            x: f64,
            y: f64,
        }

        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGEventSourceCreate(state_id: u32) -> *mut c_void;
            fn CGEventCreateScrollWheelEvent(
                source: *mut c_void,
                units: u32,
                wheel_count: u32,
                wheel1: i32,
                ...
            ) -> *mut c_void;
            fn CGEventSetLocation(event: *mut c_void, location: CGPoint);
            fn CGEventPost(tap: u32, event: *mut c_void);
        }

        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            fn CFRelease(cf: *const c_void);
        }

        // 0 = pixel-based wheel event. wheel1 is vertical, wheel2 is horizontal.
        let source = CGEventSourceCreate(0);
        let event = CGEventCreateScrollWheelEvent(source, 0, 2, delta_y, delta_x);

        if event.is_null() {
            if !source.is_null() {
                CFRelease(source);
            }
            return Err("Failed to create scroll wheel event".into());
        }

        CGEventSetLocation(event, CGPoint { x, y });
        if let Err(error) = set_screenshot_window_ignores_mouse_events(&app, true) {
            CFRelease(event);
            if !source.is_null() {
                CFRelease(source);
            }
            return Err(error);
        }
        // 0 = kCGHIDEventTap. With the overlay temporarily mouse-transparent,
        // WindowServer routes the wheel event to the real window under the point.
        CGEventPost(0, event);
        CFRelease(event);
        if !source.is_null() {
            CFRelease(source);
        }

        let reset_app = app.clone();
        tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(90));
            let _ = set_screenshot_window_ignores_mouse_events(&reset_app, false);
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, x, y, delta_x, delta_y);
        Err("Scroll forwarding is only implemented on macOS".into())
    }
}

#[tauri::command]
async fn passthrough_screenshot_mouse_events(
    app: AppHandle,
    duration_ms: u64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let duration_ms = duration_ms.clamp(120, 2_500);
        set_screenshot_window_ignores_mouse_events(&app, true)?;

        tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            let _ = set_screenshot_window_ignores_mouse_events(&app, false);
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, duration_ms);
        Err("Mouse passthrough is only implemented on macOS".into())
    }
}

#[tauri::command]
async fn set_screenshot_mouse_passthrough(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        set_screenshot_window_ignores_mouse_events(&app, enabled)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, enabled);
        Ok(())
    }
}

#[tauri::command]
async fn start_long_capture_scroll_monitor(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
        use core_graphics::event::{
            CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
            CallbackResult, EventField,
        };
        use std::sync::mpsc;
        use std::time::Duration;

        let (sender, receiver) = mpsc::channel();
        let emit_app = app.clone();

        app.run_on_main_thread(move || {
            let result = LONG_CAPTURE_SCROLL_TAP.with(|tap_cell| -> Result<(), String> {
                if tap_cell.borrow().is_some() {
                    return Ok(());
                }

                let callback_app = emit_app.clone();
                let tap = CGEventTap::new(
                    CGEventTapLocation::Session,
                    CGEventTapPlacement::HeadInsertEventTap,
                    CGEventTapOptions::Default,
                    vec![CGEventType::ScrollWheel],
                    move |_proxy, event_type, event| {
                        if matches!(event_type, CGEventType::ScrollWheel) {
                            let location = event.location();
                            let point_delta_y = event.get_double_value_field(
                                EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_1,
                            );
                            let point_delta_x = event.get_double_value_field(
                                EventField::SCROLL_WHEEL_EVENT_POINT_DELTA_AXIS_2,
                            );
                            let line_delta_y = event.get_integer_value_field(
                                EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_1,
                            ) as f64;
                            let line_delta_x = event.get_integer_value_field(
                                EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_2,
                            ) as f64;
                            let delta_y = if point_delta_y.abs() > f64::EPSILON {
                                point_delta_y
                            } else {
                                line_delta_y
                            };
                            let delta_x = if point_delta_x.abs() > f64::EPSILON {
                                point_delta_x
                            } else {
                                line_delta_x
                            };

                            let is_downward_scroll =
                                delta_y < 0.0 && delta_y.abs() >= delta_x.abs();
                            if !is_downward_scroll {
                                return CallbackResult::Drop;
                            }

                            let _ = callback_app.emit_to(
                                "screenshot_window",
                                "long-capture-scroll",
                                LongCaptureScrollEvent {
                                    x: location.x,
                                    y: location.y,
                                    delta_x,
                                    delta_y,
                                },
                            );
                        }

                        CallbackResult::Keep
                    },
                )
                .map_err(|_| "Failed to create long capture scroll monitor".to_string())?;

                let source = tap.mach_port().create_runloop_source(0).map_err(|_| {
                    "Failed to create long capture scroll run loop source".to_string()
                })?;
                CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
                tap.enable();

                LONG_CAPTURE_SCROLL_SOURCE.with(|source_cell| {
                    *source_cell.borrow_mut() = Some(source);
                });
                *tap_cell.borrow_mut() = Some(tap);
                Ok(())
            });

            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;

        receiver
            .recv_timeout(Duration::from_millis(500))
            .map_err(|_| "Timed out while starting long capture scroll monitor".to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
async fn stop_long_capture_scroll_monitor(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
        use std::sync::mpsc;
        use std::time::Duration;

        let (sender, receiver) = mpsc::channel();

        app.run_on_main_thread(move || {
            LONG_CAPTURE_SCROLL_SOURCE.with(|source_cell| {
                if let Some(source) = source_cell.borrow_mut().take() {
                    CFRunLoop::get_current()
                        .remove_source(&source, unsafe { kCFRunLoopCommonModes });
                }
            });
            LONG_CAPTURE_SCROLL_TAP.with(|tap_cell| {
                let _ = tap_cell.borrow_mut().take();
            });
            let _ = sender.send(Ok(()));
        })
        .map_err(|error| error.to_string())?;

        receiver
            .recv_timeout(Duration::from_millis(500))
            .map_err(|_| "Timed out while stopping long capture scroll monitor".to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            capture_fullscreen,
            capture_screen_rect,
            capture_screen_rect_below_screenshot_window,
            list_capture_windows,
            copy_to_clipboard,
            save_to_downloads,
            ensure_screenshot_window,
            set_dock_icon_visible,
            finish_capture,
            open_devtools,
            open_screenshot_devtools,
            is_accessibility_trusted,
            get_macos_permissions,
            open_macos_permission_settings,
            post_scroll_wheel,
            passthrough_screenshot_mouse_events,
            set_screenshot_mouse_passthrough,
            start_long_capture_scroll_monitor,
            stop_long_capture_scroll_monitor
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
                        show_main_window(app);
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
                show_main_window(app_handle);
            }
        });
}
