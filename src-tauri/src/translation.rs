use serde_json::Value;
use std::time::Duration;

fn parse_google_translation_response(payload: Value) -> Result<String, String> {
    let Some(segments) = payload.get(0).and_then(Value::as_array) else {
        return Err("Could not parse translation response".into());
    };

    let translated = segments
        .iter()
        .filter_map(|segment| {
            segment
                .as_array()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
        })
        .collect::<String>();

    if translated.trim().is_empty() {
        Err("Translation returned empty result".into())
    } else {
        Ok(translated)
    }
}

async fn translate_one_google(
    client: &reqwest::Client,
    text: &str,
    target_lang: &str,
) -> Result<String, String> {
    let response = client
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", target_lang),
            ("dt", "t"),
            ("q", text),
        ])
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send()
        .await
        .map_err(|error| format!("Translation request failed: {}", error))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Translation service returned {}", status));
    }

    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Could not parse translation response: {}", error))?;
    parse_google_translation_response(payload)
}

#[tauri::command]
pub async fn translate_texts(
    texts: Vec<String>,
    target_lang: String,
) -> Result<Vec<String>, String> {
    let target_lang = target_lang.trim().to_string();
    if target_lang.is_empty() {
        return Err("Translation target language is empty".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Failed to prepare translation client: {}", error))?;

    let mut results = vec![None; texts.len()];
    let mut handles = Vec::new();

    for (index, text) in texts.into_iter().enumerate() {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            results[index] = Some(text);
            continue;
        }

        let client = client.clone();
        let target_lang = target_lang.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            let translated = translate_one_google(&client, &trimmed, &target_lang).await;
            (index, translated)
        }));
    }

    for handle in handles {
        let (index, translated) = handle.await.map_err(|error| error.to_string())?;
        results[index] = Some(translated?);
    }

    Ok(results
        .into_iter()
        .map(|text| text.unwrap_or_default())
        .collect())
}
