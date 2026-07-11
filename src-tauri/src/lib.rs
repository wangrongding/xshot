#[cfg(not(target_os = "macos"))]
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use xcap::Monitor;
#[cfg(not(target_os = "macos"))]
use xcap::Window;

mod ocr;
mod translation;

const SCREENSHOT_WINDOW_PREFIX: &str = "screenshot_window";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureMonitor {
    id: u32,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: f64,
    is_primary: bool,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PinWindowPayload {
    image_path: String,
    image_width: f64,
    image_height: f64,
    initial_width: f64,
    initial_height: f64,
}

#[derive(Default)]
struct PinWindowStore(Mutex<HashMap<String, PinWindowPayload>>);

#[derive(Default)]
struct PreparedCaptureStore(Mutex<HashMap<(String, String), Vec<u8>>>);

#[derive(Default)]
struct PreparedCaptureWindowStore(Mutex<HashMap<(String, String), Vec<CaptureWindowRegion>>>);

struct CaptureWindowSnapshot {
    id: u32,
    pid: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    is_focused: bool,
    title: String,
    app_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureStartPayload {
    #[serde(flatten)]
    monitor: CaptureMonitor,
    capture_id: String,
    source: String,
    triggered_at_ms: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureUiTiming {
    capture_id: String,
    source: String,
    monitor_label: String,
    status: String,
    stage: String,
    ui_total_ms: f64,
    e2e_ms: f64,
    error: Option<String>,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct CaptureFocusFollowerState(std::sync::atomic::AtomicU64);

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureHoverPointPayload {
    label: String,
    x: f64,
    y: f64,
    monitor_width: f64,
    monitor_height: f64,
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
        if let Some((_, window)) = screenshot_windows(&app).into_iter().next() {
            window.open_devtools();
        }
    }

    #[cfg(not(debug_assertions))]
    let _ = app;
}

fn screenshot_window_label(monitor_id: u32) -> String {
    format!("{}_{}", SCREENSHOT_WINDOW_PREFIX, monitor_id)
}

fn is_screenshot_window_label(label: &str) -> bool {
    label == SCREENSHOT_WINDOW_PREFIX
        || label
            .strip_prefix(SCREENSHOT_WINDOW_PREFIX)
            .is_some_and(|suffix| suffix.starts_with('_'))
}

fn screenshot_windows(app: &AppHandle) -> Vec<(String, WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| is_screenshot_window_label(label))
        .collect()
}

fn first_screenshot_window_label(app: &AppHandle) -> Option<String> {
    screenshot_windows(app)
        .into_iter()
        .map(|(label, _)| label)
        .next()
}

fn capture_monitors() -> Result<Vec<CaptureMonitor>, String> {
    let mut monitors = Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|monitor| {
            let id = monitor.id().map_err(|e| e.to_string())?;
            Ok(CaptureMonitor {
                id,
                label: screenshot_window_label(id),
                x: monitor.x().map_err(|e| e.to_string())? as f64,
                y: monitor.y().map_err(|e| e.to_string())? as f64,
                width: monitor.width().map_err(|e| e.to_string())? as f64,
                height: monitor.height().map_err(|e| e.to_string())? as f64,
                scale_factor: monitor.scale_factor().unwrap_or(1.0) as f64,
                is_primary: monitor.is_primary().unwrap_or(false),
                name: monitor.name().unwrap_or_else(|_| format!("Display {}", id)),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    monitors.sort_by(|a, b| {
        b.is_primary
            .cmp(&a.is_primary)
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
    });

    Ok(monitors)
}

#[cfg(target_os = "macos")]
fn apply_macos_screenshot_window_style(
    app: &AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    use std::sync::mpsc;
    use std::time::Duration;

    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = unsafe {
            match window.ns_window() {
                Ok(ns_window) => {
                    let ns_window = &*(ns_window as *mut NSWindow);
                    ns_window.setLevel(25);
                    ns_window.setIgnoresMouseEvents(false);
                    ns_window.setAcceptsMouseMovedEvents(true);
                    ns_window.setCollectionBehavior(
                        ns_window.collectionBehavior()
                            | NSWindowCollectionBehavior::CanJoinAllSpaces
                            | NSWindowCollectionBehavior::FullScreenAuxiliary,
                    );
                    Ok(())
                }
                Err(error) => Err(error.to_string()),
            }
        };
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(Duration::from_millis(500))
        .map_err(|_| "Timed out while preparing screenshot window".to_string())?
}

fn configure_screenshot_window(
    app: &AppHandle,
    window: &WebviewWindow,
    monitor: &CaptureMonitor,
) -> Result<(), String> {
    window
        .set_position(LogicalPosition::new(monitor.x, monitor.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(monitor.width, monitor.height))
        .map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);

    #[cfg(target_os = "macos")]
    apply_macos_screenshot_window_style(app, window.clone())?;

    Ok(())
}

fn hide_screenshot_windows(app: &AppHandle) -> Result<(), String> {
    for (_, window) in screenshot_windows(app) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn focus_screenshot_window_for_hover(app: &AppHandle, label: &str) -> bool {
    use objc2_app_kit::NSWindow;

    let Some(window) = app.get_webview_window(label) else {
        return false;
    };

    if !window.is_visible().unwrap_or(false) {
        return false;
    }

    let _ = window.set_focus();
    let ns_window_handle = window.clone();
    let _ = app.run_on_main_thread(move || unsafe {
        if let Ok(ns_window) = ns_window_handle.ns_window() {
            let ns_window = &*(ns_window as *mut NSWindow);
            ns_window.setAcceptsMouseMovedEvents(true);
            ns_window.makeKeyAndOrderFront(None);
        }
    });

    true
}

#[cfg(target_os = "macos")]
fn start_capture_focus_follower(app: AppHandle, monitors: Vec<CaptureMonitor>) {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    let generation = app
        .state::<CaptureFocusFollowerState>()
        .0
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    tauri::async_runtime::spawn_blocking(move || {
        let event_source = match CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
            Ok(source) => source,
            Err(_) => return,
        };
        let mut active_label: Option<String> = None;

        while app
            .state::<CaptureFocusFollowerState>()
            .0
            .load(Ordering::SeqCst)
            == generation
        {
            let target_monitor = CGEvent::new(event_source.clone())
                .ok()
                .map(|event| event.location())
                .and_then(|point| {
                    monitors.iter().find(|monitor| {
                        point.x >= monitor.x
                            && point.x < monitor.x + monitor.width
                            && point.y >= monitor.y
                            && point.y < monitor.y + monitor.height
                    })
                });

            if let Some(monitor) = target_monitor {
                if active_label.as_deref() != Some(monitor.label.as_str())
                    && focus_screenshot_window_for_hover(&app, &monitor.label)
                {
                    if let Some(previous_label) = active_label.as_deref() {
                        let _ = app.emit_to(previous_label, "capture-hover-clear", ());
                    }
                    active_label = Some(monitor.label.clone());
                    if let Ok(event) = CGEvent::new(event_source.clone()) {
                        let point = event.location();
                        let _ = app.emit_to(
                            monitor.label.as_str(),
                            "capture-hover-point",
                            CaptureHoverPointPayload {
                                label: monitor.label.clone(),
                                x: point.x - monitor.x,
                                y: point.y - monitor.y,
                                monitor_width: monitor.width,
                                monitor_height: monitor.height,
                            },
                        );
                    }
                }
            } else {
                if let Some(previous_label) = active_label.as_deref() {
                    let _ = app.emit_to(previous_label, "capture-hover-clear", ());
                }
                active_label = None;
            }

            std::thread::sleep(Duration::from_millis(35));
        }
    });
}

#[cfg(target_os = "macos")]
fn stop_capture_focus_follower(app: &AppHandle) {
    use std::sync::atomic::Ordering;

    app.state::<CaptureFocusFollowerState>()
        .0
        .fetch_add(1, Ordering::SeqCst);
}

fn unix_epoch_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or_default()
}

fn native_capture_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    format!("rust-{}-{}", unix_epoch_ms().round() as u128, sequence)
}

fn log_capture_stage(
    capture_id: &str,
    source: &str,
    triggered_at_ms: f64,
    total: std::time::Instant,
    stage_start: std::time::Instant,
    stage: &str,
    extra: &str,
) {
    println!(
        "[xshot][capture][rust] capture_id={} source={} stage={} stage_ms={:.1} rust_total_ms={:.1} e2e_ms={:.1}{}",
        capture_id,
        source,
        stage,
        stage_start.elapsed().as_secs_f64() * 1000.0,
        total.elapsed().as_secs_f64() * 1000.0,
        unix_epoch_ms() - triggered_at_ms,
        extra,
    );
}

fn log_capture_stage_duration(
    capture_id: &str,
    source: &str,
    triggered_at_ms: f64,
    total: std::time::Instant,
    stage_ms: f64,
    stage: &str,
    extra: &str,
) {
    println!(
        "[xshot][capture][rust] capture_id={} source={} stage={} stage_ms={:.1} rust_total_ms={:.1} e2e_ms={:.1}{}",
        capture_id,
        source,
        stage,
        stage_ms,
        total.elapsed().as_secs_f64() * 1000.0,
        unix_epoch_ms() - triggered_at_ms,
        extra,
    );
}

fn log_capture_failure(
    capture_id: &str,
    source: &str,
    triggered_at_ms: f64,
    total: std::time::Instant,
    stage_start: std::time::Instant,
    stage: &str,
    error: &str,
) {
    println!(
        "[xshot][capture][rust] capture_id={} source={} stage=failed failed_stage={} stage_ms={:.1} rust_total_ms={:.1} e2e_ms={:.1} error={:?}",
        capture_id,
        source,
        stage,
        stage_start.elapsed().as_secs_f64() * 1000.0,
        total.elapsed().as_secs_f64() * 1000.0,
        unix_epoch_ms() - triggered_at_ms,
        error,
    );
}

#[cfg(target_os = "macos")]
fn capture_monitor_image(
    monitor: &CaptureMonitor,
    capture_id: &str,
    source: &str,
) -> Result<Vec<u8>, String> {
    use std::fs;
    use std::process::Command;

    let start_time = std::time::Instant::now();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temp_file = std::env::temp_dir().join(format!(
        "xshot_capture_screen_{}_{}_{}.png",
        std::process::id(),
        monitor.id,
        timestamp
    ));
    let rect = format!(
        "{},{},{},{}",
        monitor.x.round() as i64,
        monitor.y.round() as i64,
        monitor.width.round().max(1.0) as i64,
        monitor.height.round().max(1.0) as i64
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
            "screencapture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bytes = fs::read(&temp_file).map_err(|e| format!("Failed to read capture file: {}", e))?;
    let _ = fs::remove_file(temp_file);

    println!(
        "[xshot][capture][rust] capture_id={} source={} stage=capture_monitor_image_detail monitor={} rect={} bytes={} elapsed_ms={:.1}",
        capture_id,
        source,
        monitor.label,
        rect,
        bytes.len(),
        start_time.elapsed().as_secs_f64() * 1000.0,
    );
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
fn capture_monitor_image(
    monitor: &CaptureMonitor,
    capture_id: &str,
    source: &str,
) -> Result<Vec<u8>, String> {
    let start_time = std::time::Instant::now();
    let target_monitor = Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|candidate| candidate.id().ok() == Some(monitor.id))
        .ok_or("No monitor found")?;
    let image = target_monitor.capture_image().map_err(|e| e.to_string())?;
    let mut bytes: Vec<u8> = Vec::new();
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

    println!(
        "[xshot][capture][rust] capture_id={} source={} stage=capture_monitor_image_detail monitor={} bytes={} elapsed_ms={:.1}",
        capture_id,
        source,
        monitor.label,
        bytes.len(),
        start_time.elapsed().as_secs_f64() * 1000.0,
    );
    Ok(bytes)
}

#[tauri::command]
async fn ensure_screenshot_window(app: AppHandle) -> Result<(), String> {
    let monitors = capture_monitors()?;
    if monitors.is_empty() {
        return Err("No monitor found".into());
    }

    let active_labels = monitors
        .iter()
        .map(|monitor| monitor.label.clone())
        .collect::<HashSet<_>>();

    for (label, window) in screenshot_windows(&app) {
        if !active_labels.contains(&label) {
            let _ = window.hide();
        }
    }

    for monitor in monitors {
        let window = if let Some(window) = app.get_webview_window(&monitor.label) {
            window
        } else {
            println!("Creating screenshot window {}...", monitor.label);
            WebviewWindowBuilder::new(&app, &monitor.label, WebviewUrl::App("/screenshot".into()))
                .title("Screenshot")
                .visible(false)
                .decorations(false)
                .resizable(false)
                .minimizable(false)
                .maximizable(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .transparent(true)
                .position(monitor.x, monitor.y)
                .inner_size(monitor.width, monitor.height)
                .build()
                .map_err(|e| e.to_string())?
        };

        configure_screenshot_window(&app, &window, &monitor)?;
    }

    Ok(())
}

#[tauri::command]
async fn start_capture(
    app: AppHandle,
    capture_id: Option<String>,
    source: Option<String>,
    triggered_at_ms: Option<f64>,
) -> Result<(), String> {
    let capture_id = capture_id.unwrap_or_else(native_capture_id);
    let source = source.unwrap_or_else(|| "native".to_string());
    let triggered_at_ms = triggered_at_ms.unwrap_or_else(unix_epoch_ms);
    let total = std::time::Instant::now();
    let entered = std::time::Instant::now();
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        entered,
        "rust_command_entered",
        "",
    );

    let stage = std::time::Instant::now();
    if let Err(error) = ensure_screenshot_window(app.clone()).await {
        log_capture_failure(
            &capture_id,
            &source,
            triggered_at_ms,
            total,
            stage,
            "ensure_screenshot_window",
            &error,
        );
        return Err(error);
    }
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "ensure_screenshot_window",
        "",
    );

    #[cfg(target_os = "macos")]
    {
        let stage = std::time::Instant::now();
        let _ = stop_long_capture_scroll_monitor(app.clone()).await;
        let _ = set_screenshot_window_ignores_mouse_events(&app, None, false);
        log_capture_stage(
            &capture_id,
            &source,
            triggered_at_ms,
            total,
            stage,
            "stop_long_capture_and_restore_mouse",
            "",
        );
    }

    let stage = std::time::Instant::now();
    if let Err(error) = hide_screenshot_windows(&app) {
        log_capture_failure(
            &capture_id,
            &source,
            triggered_at_ms,
            total,
            stage,
            "hide_screenshot_windows",
            &error,
        );
        return Err(error);
    }
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "hide_screenshot_windows",
        "",
    );

    let stage = std::time::Instant::now();
    let monitors = match capture_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            log_capture_failure(
                &capture_id,
                &source,
                triggered_at_ms,
                total,
                stage,
                "capture_monitors",
                &error,
            );
            return Err(error);
        }
    };
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "capture_monitors",
        &format!(" count={}", monitors.len()),
    );

    let window_monitors = monitors.clone();
    let window_regions_handle = std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let result = capture_window_regions(&window_monitors);
        (result, started.elapsed())
    });

    let capture_handles = monitors
        .iter()
        .cloned()
        .map(|monitor| {
            let capture_id = capture_id.clone();
            let source = source.clone();
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                let result = capture_monitor_image(&monitor, &capture_id, &source);
                (monitor, result, started.elapsed())
            })
        })
        .collect::<Vec<_>>();

    let mut prepared = HashMap::new();
    for handle in capture_handles {
        let (monitor, result, elapsed) = match handle.join() {
            Ok(result) => result,
            Err(_) => {
                let error = "Capture monitor worker panicked".to_string();
                log_capture_failure(
                    &capture_id,
                    &source,
                    triggered_at_ms,
                    total,
                    total,
                    "capture_monitor_image_parallel",
                    &error,
                );
                return Err(error);
            }
        };
        let bytes = match result {
            Ok(bytes) => bytes,
            Err(error) => {
                log_capture_stage_duration(
                    &capture_id,
                    &source,
                    triggered_at_ms,
                    total,
                    elapsed.as_secs_f64() * 1000.0,
                    "capture_monitor_image_failed",
                    &format!(" monitor={} error={:?}", monitor.label, error),
                );
                return Err(error);
            }
        };
        let size = bytes.len();
        prepared.insert((capture_id.clone(), monitor.label.clone()), bytes);
        log_capture_stage_duration(
            &capture_id,
            &source,
            triggered_at_ms,
            total,
            elapsed.as_secs_f64() * 1000.0,
            "capture_monitor_image_parallel",
            &format!(" monitor={} bytes={}", monitor.label, size),
        );
    }

    let (window_regions_result, window_regions_elapsed) = match window_regions_handle.join() {
        Ok(result) => result,
        Err(_) => (
            Err("Capture window snapshot worker panicked".to_string()),
            std::time::Duration::ZERO,
        ),
    };
    let prepared_window_regions = match window_regions_result {
        Ok(regions) => {
            let region_count = regions.values().map(Vec::len).sum::<usize>();
            log_capture_stage_duration(
                &capture_id,
                &source,
                triggered_at_ms,
                total,
                window_regions_elapsed.as_secs_f64() * 1000.0,
                "capture_window_snapshot",
                &format!(" monitors={} regions={}", regions.len(), region_count),
            );
            regions
        }
        Err(error) => {
            log_capture_stage_duration(
                &capture_id,
                &source,
                triggered_at_ms,
                total,
                window_regions_elapsed.as_secs_f64() * 1000.0,
                "capture_window_snapshot_failed",
                &format!(" error={:?}", error),
            );
            monitors
                .iter()
                .map(|monitor| (monitor.label.clone(), Vec::new()))
                .collect()
        }
    };

    let stage = std::time::Instant::now();
    {
        let store = app.state::<PreparedCaptureStore>();
        let mut store = match store.0.lock() {
            Ok(store) => store,
            Err(_) => {
                let error = "Failed to lock prepared capture store".to_string();
                log_capture_failure(
                    &capture_id,
                    &source,
                    triggered_at_ms,
                    total,
                    stage,
                    "store_prepared_captures",
                    &error,
                );
                return Err(error);
            }
        };
        store.extend(prepared);
    }
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "store_prepared_captures",
        "",
    );

    let stage = std::time::Instant::now();
    {
        let store = app.state::<PreparedCaptureWindowStore>();
        let mut store = store
            .0
            .lock()
            .map_err(|_| "Failed to lock prepared capture window store".to_string())?;
        store.extend(
            prepared_window_regions
                .into_iter()
                .map(|(label, regions)| ((capture_id.clone(), label), regions)),
        );
    }
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "store_prepared_capture_windows",
        "",
    );

    let stage = std::time::Instant::now();
    for monitor in &monitors {
        let payload = CaptureStartPayload {
            monitor: monitor.clone(),
            capture_id: capture_id.clone(),
            source: source.clone(),
            triggered_at_ms,
        };
        if let Err(error) = app.emit("start-capture", payload) {
            let error = error.to_string();
            log_capture_failure(
                &capture_id,
                &source,
                triggered_at_ms,
                total,
                stage,
                "emit_start_capture",
                &error,
            );
            return Err(error);
        }
    }
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "emit_start_capture",
        &format!(" count={}", monitors.len()),
    );

    #[cfg(target_os = "macos")]
    {
        let stage = std::time::Instant::now();
        start_capture_focus_follower(app, monitors);
        log_capture_stage(
            &capture_id,
            &source,
            triggered_at_ms,
            total,
            stage,
            "start_focus_follower",
            "",
        );
    }

    let stage = std::time::Instant::now();
    log_capture_stage(
        &capture_id,
        &source,
        triggered_at_ms,
        total,
        stage,
        "rust_command_done_before_ui_ready",
        "",
    );
    Ok(())
}

#[tauri::command]
async fn finish_capture(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    stop_capture_focus_follower(&app);
    #[cfg(target_os = "macos")]
    let _ = stop_long_capture_scroll_monitor(app.clone()).await;
    #[cfg(target_os = "macos")]
    let _ = set_screenshot_window_ignores_mouse_events(&app, None, false);

    {
        let store = app.state::<PreparedCaptureStore>();
        let _ = store.0.lock().map(|mut captures| captures.clear());
    }
    {
        let store = app.state::<PreparedCaptureWindowStore>();
        let _ = store.0.lock().map(|mut windows| windows.clear());
    }

    hide_screenshot_windows(&app)
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
async fn capture_fullscreen(
    app: AppHandle,
    window_label: Option<String>,
    capture_id: Option<String>,
    source: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let capture_id = capture_id.unwrap_or_else(|| "legacy".to_string());
    let source = source.unwrap_or_else(|| "unknown".to_string());
    let start_time = std::time::Instant::now();
    if let Some(label) = window_label.as_deref() {
        let prepared = {
            let store = app.state::<PreparedCaptureStore>();
            let mut captures = store
                .0
                .lock()
                .map_err(|_| "Failed to lock prepared capture store".to_string())?;
            captures.remove(&(capture_id.clone(), label.to_string()))
        };
        if let Some(bytes) = prepared {
            println!(
                "[xshot][capture][rust] capture_id={} source={} stage=capture_fullscreen_prepared_hit monitor={} bytes={} elapsed_ms={:.1}",
                capture_id,
                source,
                label,
                bytes.len(),
                start_time.elapsed().as_secs_f64() * 1000.0,
            );
            return Ok(tauri::ipc::Response::new(bytes));
        }
        println!(
            "[xshot][capture][rust] capture_id={} source={} stage=capture_fullscreen_prepared_miss monitor={}",
            capture_id, source, label
        );
    }

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
        let fallback_label = first_screenshot_window_label(&app)
            .unwrap_or_else(|| SCREENSHOT_WINDOW_PREFIX.to_string());
        let target_label = window_label.unwrap_or(fallback_label);
        let screenshot_window = app
            .get_webview_window(&target_label)
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
            "[xshot][capture][rust] capture_id={} source={} stage=capture_fullscreen_fallback monitor={} rect={} bytes={} elapsed_ms={:.1}",
            capture_id,
            source,
            target_label,
            rect,
            bytes.len(),
            start_time.elapsed().as_secs_f64() * 1000.0,
        );
        Ok(tauri::ipc::Response::new(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let target_label = window_label
            .or_else(|| first_screenshot_window_label(&app))
            .unwrap_or_else(|| SCREENSHOT_WINDOW_PREFIX.to_string());
        let monitor_id = target_label
            .strip_prefix(&(SCREENSHOT_WINDOW_PREFIX.to_string() + "_"))
            .and_then(|id| id.parse::<u32>().ok());
        let monitor = monitors
            .iter()
            .find(|monitor| monitor_id.is_some_and(|id| monitor.id().ok() == Some(id)))
            .or_else(|| monitors.first())
            .ok_or("No monitor found")?;
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

        println!(
            "[xshot][capture][rust] capture_id={} source={} stage=capture_fullscreen_fallback monitor={} bytes={} elapsed_ms={:.1}",
            capture_id,
            source,
            target_label,
            bytes.len(),
            start_time.elapsed().as_secs_f64() * 1000.0,
        );
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
fn screenshot_window_number(app: &AppHandle, window_label: Option<&str>) -> Result<u32, String> {
    use objc2_app_kit::NSWindow;
    use std::sync::mpsc;
    use std::time::Duration;

    let target_label = window_label
        .map(ToOwned::to_owned)
        .or_else(|| first_screenshot_window_label(app))
        .unwrap_or_else(|| SCREENSHOT_WINDOW_PREFIX.to_string());
    let window = app
        .get_webview_window(&target_label)
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
    window_label: Option<String>,
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

        let window_number = screenshot_window_number(&app, window_label.as_deref())?;
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
        let _ = (app, window_label, x, y, width, height);
        Err("Below-window rectangle capture is only implemented on macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn capture_window_snapshots() -> Result<Vec<CaptureWindowSnapshot>, String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_core_foundation::{CFDictionary, CFNumber, CFNumberType, CFString, CGRect};
    use objc2_core_graphics::{
        CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
    };
    use std::ffi::c_void;

    unsafe fn dictionary_value(dictionary: &CFDictionary, key: &str) -> Option<*const c_void> {
        let key = CFString::from_str(key);
        let value = dictionary.value((&*key as *const CFString).cast());
        (!value.is_null()).then_some(value)
    }

    unsafe fn number_i32(dictionary: &CFDictionary, key: &str) -> Option<i32> {
        let number = dictionary_value(dictionary, key)? as *const CFNumber;
        let mut value = 0_i32;
        (*number)
            .value(
                CFNumberType::IntType,
                (&mut value as *mut i32).cast::<c_void>(),
            )
            .then_some(value)
    }

    unsafe fn string_value(dictionary: &CFDictionary, key: &str) -> Option<String> {
        let value = dictionary_value(dictionary, key)? as *const CFString;
        Some((*value).to_string())
    }

    unsafe fn bounds(dictionary: &CFDictionary) -> Option<CGRect> {
        let bounds = dictionary_value(dictionary, "kCGWindowBounds")? as *const CFDictionary;
        let mut rect = CGRect::default();
        CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut rect).then_some(rect)
    }

    let active_pid = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|application| application.processIdentifier() as u32);

    let window_info = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        0,
    )
    .ok_or("Failed to get macOS window snapshot")?;

    let mut snapshots = Vec::with_capacity(window_info.count().max(0) as usize);
    for index in 0..window_info.count() {
        let dictionary = unsafe { window_info.value_at_index(index) as *const CFDictionary };
        if dictionary.is_null() {
            continue;
        }
        let dictionary = unsafe { &*dictionary };
        let Some(id) = (unsafe { number_i32(dictionary, "kCGWindowNumber") }) else {
            continue;
        };
        if unsafe { number_i32(dictionary, "kCGWindowSharingState") } == Some(0) {
            continue;
        }
        let Some(rect) = (unsafe { bounds(dictionary) }) else {
            continue;
        };
        let pid = unsafe { number_i32(dictionary, "kCGWindowOwnerPID") }.unwrap_or_default() as u32;
        let app_name =
            unsafe { string_value(dictionary, "kCGWindowOwnerName") }.unwrap_or_default();
        let title = unsafe { string_value(dictionary, "kCGWindowName") }.unwrap_or_default();

        snapshots.push(CaptureWindowSnapshot {
            id: id as u32,
            pid,
            x: rect.origin.x.round() as i32,
            y: rect.origin.y.round() as i32,
            width: rect.size.width.round() as i32,
            height: rect.size.height.round() as i32,
            is_focused: active_pid == Some(pid),
            title,
            app_name,
        });
    }
    Ok(snapshots)
}

#[cfg(not(target_os = "macos"))]
fn capture_window_snapshots() -> Result<Vec<CaptureWindowSnapshot>, String> {
    let windows = Window::all().map_err(|error| error.to_string())?;
    let mut snapshots = Vec::with_capacity(windows.len());
    for window in windows {
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        let (Ok(id), Ok(x), Ok(y), Ok(width), Ok(height)) = (
            window.id(),
            window.x(),
            window.y(),
            window.width(),
            window.height(),
        ) else {
            continue;
        };
        snapshots.push(CaptureWindowSnapshot {
            id,
            pid: window.pid().unwrap_or_default(),
            x,
            y,
            width: width as i32,
            height: height as i32,
            is_focused: window.is_focused().unwrap_or(false),
            title: window.title().unwrap_or_default(),
            app_name: window.app_name().unwrap_or_default(),
        });
    }
    Ok(snapshots)
}

fn capture_window_regions(
    monitors: &[CaptureMonitor],
) -> Result<HashMap<String, Vec<CaptureWindowRegion>>, String> {
    let windows = capture_window_snapshots()?;
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
    let mut regions_by_monitor = HashMap::with_capacity(monitors.len());

    for monitor in monitors {
        let monitor_x = monitor.x.round() as i32;
        let monitor_y = monitor.y.round() as i32;
        let monitor_width = monitor.width.round().max(1.0) as i32;
        let monitor_height = monitor.height.round().max(1.0) as i32;
        let monitor_right = monitor_x + monitor_width;
        let monitor_bottom = monitor_y + monitor_height;
        let mut regions = Vec::new();

        for window in &windows {
            if window.pid == current_pid
                || window.width < 40
                || window.height < 40
                || ignored_apps
                    .iter()
                    .any(|ignored| window.app_name.eq_ignore_ascii_case(ignored))
            {
                continue;
            }

            let left = window.x.max(monitor_x);
            let top = window.y.max(monitor_y);
            let right = (window.x + window.width).min(monitor_right);
            let bottom = (window.y + window.height).min(monitor_bottom);
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
            let is_overlay_candidate =
                covers_whole_monitor && window.title.trim().is_empty() && !window.is_focused;

            regions.push(CaptureWindowRegion {
                id: window.id,
                pid: window.pid,
                x: (left - monitor_x) as f64,
                y: (top - monitor_y) as f64,
                width: clipped_width as f64,
                height: clipped_height as f64,
                monitor_width: monitor_width as f64,
                monitor_height: monitor_height as f64,
                is_fullscreen_like: covers_whole_monitor,
                is_overlay_candidate,
                is_focused: window.is_focused,
                title: window.title.clone(),
                app_name: window.app_name.clone(),
            });
        }
        regions_by_monitor.insert(monitor.label.clone(), regions);
    }

    Ok(regions_by_monitor)
}

#[tauri::command]
async fn list_capture_windows(
    app: AppHandle,
    window_label: Option<String>,
    capture_id: Option<String>,
    source: Option<String>,
) -> Result<Vec<CaptureWindowRegion>, String> {
    let capture_id = capture_id.unwrap_or_else(|| "legacy".to_string());
    let source = source.unwrap_or_else(|| "unknown".to_string());
    let monitors = capture_monitors()?;
    let target_label = window_label
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| monitor.is_primary)
                .or_else(|| monitors.first())
                .map(|monitor| monitor.label.clone())
        })
        .ok_or("No monitor found")?;
    let key = (capture_id.clone(), target_label.clone());

    if let Some(regions) = app
        .state::<PreparedCaptureWindowStore>()
        .0
        .lock()
        .map_err(|_| "Failed to lock prepared capture window store".to_string())?
        .remove(&key)
    {
        println!(
            "[xshot][capture][rust] capture_id={} source={} stage=list_capture_windows_prepared_hit monitor={} regions={}",
            capture_id,
            source,
            target_label,
            regions.len(),
        );
        return Ok(regions);
    }

    let total = std::time::Instant::now();
    let mut regions_by_monitor = capture_window_regions(&monitors)?;
    let regions = regions_by_monitor.remove(&target_label).unwrap_or_default();
    println!(
        "[xshot][capture][rust] capture_id={} source={} stage=list_capture_windows_fallback monitor={} regions={} elapsed_ms={:.1}",
        capture_id,
        source,
        target_label,
        regions.len(),
        total.elapsed().as_secs_f64() * 1000.0,
    );
    Ok(regions)
}

#[tauri::command]
fn record_capture_ui_timing(timing: CaptureUiTiming) {
    println!(
        "[xshot][capture][ready] capture_id={} source={} monitor={} status={} stage={} ui_total_ms={:.1} e2e_ms={:.1} error={:?}",
        timing.capture_id,
        timing.source,
        timing.monitor_label,
        timing.status,
        timing.stage,
        timing.ui_total_ms,
        timing.e2e_ms,
        timing.error,
    );
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
async fn copy_text_to_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write text to clipboard: {}", e))
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

fn pin_window_temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("xshot-pins")
}

fn compute_pin_window_size(
    app: &AppHandle,
    image_width: f64,
    image_height: f64,
    source_window_label: Option<&str>,
) -> (f64, f64, f64, f64) {
    let fallback_width = 720.0;
    let fallback_height = 480.0;
    let safe_width = image_width.max(1.0);
    let safe_height = image_height.max(1.0);
    let monitor = source_window_label
        .and_then(|label| app.get_webview_window(label))
        .or_else(|| {
            first_screenshot_window_label(app).and_then(|label| app.get_webview_window(&label))
        })
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        let scale = f64::min(
            1.0,
            f64::min(fallback_width / safe_width, fallback_height / safe_height),
        );
        return (
            (safe_width * scale).round().max(96.0),
            (safe_height * scale).round().max(64.0),
            80.0,
            80.0,
        );
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor().max(1.0);
    let work_x = work_area.position.x as f64 / scale_factor;
    let work_y = work_area.position.y as f64 / scale_factor;
    let work_width = work_area.size.width as f64 / scale_factor;
    let work_height = work_area.size.height as f64 / scale_factor;
    let max_width = (work_width * 0.8).max(96.0);
    let max_height = (work_height * 0.8).max(64.0);
    let scale = f64::min(
        1.0,
        f64::min(max_width / safe_width, max_height / safe_height),
    );
    let initial_width = (safe_width * scale).round().max(96.0);
    let initial_height = (safe_height * scale).round().max(64.0);
    let x = work_x + (work_width - initial_width) / 2.0;
    let y = work_y + (work_height - initial_height) / 2.0;

    (initial_width, initial_height, x, y)
}

fn cleanup_pin_payload(app: &AppHandle, label: &str) {
    let store = app.state::<PinWindowStore>();
    let payload = store
        .0
        .lock()
        .ok()
        .and_then(|mut payloads| payloads.remove(label));

    if let Some(payload) = payload {
        let _ = std::fs::remove_file(payload.image_path);
    }
}

#[tauri::command]
async fn show_pin_window(
    app: AppHandle,
    blob_data: Vec<u8>,
    window_label: Option<String>,
) -> Result<(), String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let image = image::load_from_memory(&blob_data)
        .map_err(|e| format!("Failed to decode pinned image: {}", e))?;
    let image_width = image.width() as f64;
    let image_height = image.height() as f64;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let label = format!("pin_window_{}_{}", std::process::id(), timestamp);
    let pin_dir = pin_window_temp_dir();
    fs::create_dir_all(&pin_dir).map_err(|e| format!("Failed to prepare pin directory: {}", e))?;
    let image_path = pin_dir.join(format!("{}.png", label));
    fs::write(&image_path, &blob_data)
        .map_err(|e| format!("Failed to write pinned image: {}", e))?;

    let (initial_width, initial_height, x, y) =
        compute_pin_window_size(&app, image_width, image_height, window_label.as_deref());
    let payload = PinWindowPayload {
        image_path: image_path.to_string_lossy().to_string(),
        image_width,
        image_height,
        initial_width,
        initial_height,
    };

    {
        let store = app.state::<PinWindowStore>();
        store
            .0
            .lock()
            .map_err(|_| "Failed to lock pin window store".to_string())?
            .insert(label.clone(), payload);
    }

    let build_result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("/pin".into()))
        .title("Pinned Screenshot")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(true)
        .inner_size(initial_width, initial_height)
        .min_inner_size(96.0, 64.0)
        .position(x, y)
        .build();

    match build_result {
        Ok(window) => {
            let _ = window.set_always_on_top(true);
            Ok(())
        }
        Err(error) => {
            cleanup_pin_payload(&app, &label);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn get_pin_window_payload(app: AppHandle, label: String) -> Result<PinWindowPayload, String> {
    let store = app.state::<PinWindowStore>();
    let payload = store
        .0
        .lock()
        .map_err(|_| "Failed to lock pin window store".to_string())?
        .get(&label)
        .cloned();

    payload.ok_or_else(|| "Pinned image not found".to_string())
}

#[tauri::command]
async fn close_pin_window(app: AppHandle, label: String) -> Result<(), String> {
    cleanup_pin_payload(&app, &label);

    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
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
    window_label: Option<&str>,
    ignores_mouse_events: bool,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use std::sync::mpsc;
    use std::time::Duration;

    let windows = if let Some(label) = window_label {
        vec![app
            .get_webview_window(label)
            .ok_or("Screenshot window not found")?]
    } else {
        screenshot_windows(app)
            .into_iter()
            .map(|(_, window)| window)
            .collect::<Vec<_>>()
    };

    let (sender, receiver) = mpsc::channel();

    app.run_on_main_thread(move || {
        let result: Result<(), String> = unsafe {
            for window in windows {
                match window.ns_window() {
                    Ok(ns_window) => {
                        let ns_window = &*(ns_window as *mut NSWindow);
                        ns_window.setIgnoresMouseEvents(ignores_mouse_events);
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                        return;
                    }
                }
            }
            Ok(())
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
        if let Err(error) = set_screenshot_window_ignores_mouse_events(&app, None, true) {
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
            let _ = set_screenshot_window_ignores_mouse_events(&reset_app, None, false);
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
    window_label: Option<String>,
    duration_ms: u64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let duration_ms = duration_ms.clamp(120, 2_500);
        set_screenshot_window_ignores_mouse_events(&app, window_label.as_deref(), true)?;

        tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(duration_ms));
            let _ =
                set_screenshot_window_ignores_mouse_events(&app, window_label.as_deref(), false);
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window_label, duration_ms);
        Err("Mouse passthrough is only implemented on macOS".into())
    }
}

#[tauri::command]
async fn set_screenshot_mouse_passthrough(
    app: AppHandle,
    window_label: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        set_screenshot_window_ignores_mouse_events(&app, window_label.as_deref(), enabled)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, window_label, enabled);
        Ok(())
    }
}

#[tauri::command]
async fn start_long_capture_scroll_monitor(
    app: AppHandle,
    window_label: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
        use core_graphics::event::{
            CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
            CallbackResult, EventField,
        };
        use std::sync::mpsc;
        use std::time::Duration;

        stop_capture_focus_follower(&app);

        let (sender, receiver) = mpsc::channel();
        let emit_app = app.clone();
        let target_label = window_label
            .or_else(|| first_screenshot_window_label(&app))
            .unwrap_or_else(|| SCREENSHOT_WINDOW_PREFIX.to_string());

        app.run_on_main_thread(move || {
            let result = LONG_CAPTURE_SCROLL_TAP.with(|tap_cell| -> Result<(), String> {
                if tap_cell.borrow().is_some() {
                    return Ok(());
                }

                let callback_app = emit_app.clone();
                let callback_label = target_label.clone();
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
                                &callback_label,
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
        let _ = (app, window_label);
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
            start_capture,
            capture_fullscreen,
            capture_screen_rect,
            capture_screen_rect_below_screenshot_window,
            list_capture_windows,
            record_capture_ui_timing,
            copy_to_clipboard,
            copy_text_to_clipboard,
            ocr::ocr_image,
            translation::translate_texts,
            save_to_downloads,
            show_pin_window,
            get_pin_window_payload,
            close_pin_window,
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
            let _ = std::fs::remove_dir_all(pin_window_temp_dir());
            app.manage(PinWindowStore::default());
            app.manage(PreparedCaptureStore::default());
            app.manage(PreparedCaptureWindowStore::default());
            #[cfg(target_os = "macos")]
            app.manage(CaptureFocusFollowerState::default());

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
                            if let Err(error) =
                                start_capture(app, None, Some("tray".to_string()), None).await
                            {
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
            if let tauri::WindowEvent::Destroyed = event {
                if window.label().starts_with("pin_window_") {
                    cleanup_pin_payload(window.app_handle(), window.label());
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
