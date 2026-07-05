use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrTextBlock {
    text: String,
    confidence: f32,
    bounds: OcrBounds,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrQrCode {
    value: String,
    url: Option<String>,
    bounds: OcrBounds,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrScanResult {
    text: String,
    blocks: Vec<OcrTextBlock>,
    qr_codes: Vec<OcrQrCode>,
    image_width: u32,
    image_height: u32,
}

#[cfg(target_os = "macos")]
fn ns_error_to_string(error: objc2::rc::Retained<objc2_foundation::NSError>) -> String {
    error.localizedDescription().to_string()
}

#[cfg(target_os = "macos")]
fn vision_bounds_to_top_left(bounds: objc2_core_foundation::CGRect) -> OcrBounds {
    OcrBounds {
        x: bounds.origin.x,
        y: 1.0 - bounds.origin.y - bounds.size.height,
        width: bounds.size.width,
        height: bounds.size.height,
    }
}

#[cfg(target_os = "macos")]
fn perform_vision_text_request(
    image_data: &objc2_foundation::NSData,
    recognition_level: objc2_vision::VNRequestTextRecognitionLevel,
) -> Result<
    objc2::rc::Retained<objc2_vision::VNRecognizeTextRequest>,
    objc2::rc::Retained<objc2_foundation::NSError>,
> {
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, ClassType};
    use objc2_foundation::{NSArray, NSDictionary};
    use objc2_vision::{VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest};

    let options = NSDictionary::<VNImageOption, AnyObject>::new();
    let request = unsafe { VNRecognizeTextRequest::init(VNRecognizeTextRequest::alloc()) };
    request.setRecognitionLevel(recognition_level);
    request.setUsesLanguageCorrection(true);
    request.setAutomaticallyDetectsLanguage(true);

    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        image_data,
        &options,
    );
    let request_ref: &VNRequest = request.as_super().as_super();
    let requests = NSArray::from_slice(&[request_ref]);
    handler.performRequests_error(&requests)?;

    Ok(request)
}

#[cfg(target_os = "macos")]
fn perform_vision_barcode_request(
    image_data: &objc2_foundation::NSData,
) -> Result<
    objc2::rc::Retained<objc2_vision::VNDetectBarcodesRequest>,
    objc2::rc::Retained<objc2_foundation::NSError>,
> {
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, ClassType};
    use objc2_foundation::{NSArray, NSDictionary};
    use objc2_vision::{
        VNBarcodeSymbologyMicroQR, VNBarcodeSymbologyQR, VNDetectBarcodesRequest, VNImageOption,
        VNImageRequestHandler, VNRequest,
    };

    let options = NSDictionary::<VNImageOption, AnyObject>::new();
    let request = unsafe { VNDetectBarcodesRequest::init(VNDetectBarcodesRequest::alloc()) };
    let mut symbologies = Vec::new();
    if let Some(qr) = unsafe { VNBarcodeSymbologyQR } {
        symbologies.push(qr);
    }
    if let Some(micro_qr) = unsafe { VNBarcodeSymbologyMicroQR } {
        symbologies.push(micro_qr);
    }
    if !symbologies.is_empty() {
        let symbologies = NSArray::from_slice(&symbologies);
        unsafe { request.setSymbologies(&symbologies) };
    }

    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        image_data,
        &options,
    );
    let request_ref: &VNRequest = request.as_super().as_super();
    let requests = NSArray::from_slice(&[request_ref]);
    handler.performRequests_error(&requests)?;

    Ok(request)
}

#[cfg(target_os = "macos")]
fn perform_vision_ocr(blob_data: Vec<u8>) -> Result<OcrScanResult, String> {
    use objc2::rc::autoreleasepool;
    use objc2_foundation::NSData;
    use objc2_vision::VNRequestTextRecognitionLevel;
    use std::collections::HashSet;

    let image = image::load_from_memory(&blob_data)
        .map_err(|e| format!("Failed to decode OCR image: {}", e))?;
    let image_width = image.width();
    let image_height = image.height();

    autoreleasepool(|_| {
        let image_data = NSData::with_bytes(&blob_data);
        let text_request =
            perform_vision_text_request(&image_data, VNRequestTextRecognitionLevel::Accurate)
                .or_else(|_| {
                    perform_vision_text_request(&image_data, VNRequestTextRecognitionLevel::Fast)
                })
                .map_err(ns_error_to_string)?;

        let mut blocks = Vec::new();
        if let Some(results) = text_request.results() {
            for observation in results.iter() {
                let candidates = observation.topCandidates(1);
                let Some(candidate) = (unsafe { candidates.firstObject_unchecked() }) else {
                    continue;
                };
                let text = candidate.string().to_string();
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                blocks.push(OcrTextBlock {
                    text,
                    confidence: candidate.confidence(),
                    bounds: vision_bounds_to_top_left(unsafe { observation.boundingBox() }),
                });
            }
        }

        let mut qr_codes = Vec::new();
        if let Ok(barcode_request) = perform_vision_barcode_request(&image_data) {
            if let Some(results) = unsafe { barcode_request.results() } {
                let mut seen = HashSet::new();
                for observation in results.iter() {
                    let Some(value) = (unsafe { observation.payloadStringValue() }) else {
                        continue;
                    };
                    let value = value.to_string().trim().to_string();
                    if value.is_empty() || !seen.insert(value.clone()) {
                        continue;
                    }

                    let lower_value = value.to_lowercase();
                    let url = (lower_value.starts_with("http://")
                        || lower_value.starts_with("https://"))
                    .then(|| value.clone());

                    qr_codes.push(OcrQrCode {
                        value,
                        url,
                        bounds: vision_bounds_to_top_left(unsafe { observation.boundingBox() }),
                    });
                }
            }
        }

        let text = if blocks.is_empty() {
            qr_codes
                .iter()
                .map(|qr_code| qr_code.value.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            blocks
                .iter()
                .map(|block| block.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        };

        Ok(OcrScanResult {
            text,
            blocks,
            qr_codes,
            image_width,
            image_height,
        })
    })
}

#[tauri::command]
pub async fn ocr_image(blob_data: Vec<u8>) -> Result<OcrScanResult, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || perform_vision_ocr(blob_data))
            .await
            .map_err(|error| error.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = blob_data;
        Err("OCR is currently only implemented on macOS".into())
    }
}
