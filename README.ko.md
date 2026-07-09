# xshot

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a> |
  <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>가볍고 상주형이며 손에 익는 데스크톱 스크린샷 도구.</strong>
</p>

xshot은 빠른 캡처, 창/영역 선택, 주석, 스크롤 캡처, 자르기, 화면 고정, 복사, 저장을 지원하는 데스크톱 스크린샷 도구입니다. 기본적으로 트레이와 전역 단축키로 사용합니다.

## 다국어 문서

간체 중국어 README가 문서 유지보수의 기준입니다. 기능 설명, 설치 안내, 제한 사항, 로드맵이 바뀌면 먼저 `README.md`를 업데이트한 뒤 English, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil), Русский 버전을 동기화해 주세요.

## 핵심 기능

- ✅ 스크롤 긴 캡처를 지원합니다.
- ✅ 캡처 결과를 항상 위에 표시되는 플로팅 창으로 고정할 수 있습니다.
- ✅ OCR 텍스트 인식, QR 코드 인식, 텍스트 번역, 원문 위 번역 오버레이를 지원합니다.
- ✅ 주석 도구 지원: 번호 마커, 화살표, 사각형 선택, 직선, 텍스트, 펜, 지우개, 영역 모자이크.
- ✅ 창 hover 인식을 지원하며, 후보 창 위로 이동한 뒤 클릭하면 해당 창을 선택할 수 있습니다.
- ✅ 보이는 워터마크와 숨은 워터마크를 지원합니다. 내보내기 시 투명 텍스트를 덧씌우거나 감지 가능한 주파수 영역 워터마크를 삽입할 수 있습니다.

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## 사용 방법

앱을 시작하면 xshot은 트레이에서 실행됩니다. 다음 방식으로 캡처를 시작할 수 있습니다:

- 기본 전역 단축키 `Option + X` / `Alt + X` 누르기.

## 플랫폼 권한 및 설치

- macOS에서 처음 열 때 개발자를 확인할 수 없다는 메시지가 나오면 `시스템 설정` -> `개인정보 보호 및 보안`에서 `그래도 열기`를 선택하세요.
- 그래도 열리지 않으면 `xattr -dr com.apple.quarantine /Applications/xshot.app`를 실행한 뒤 다시 시도하세요.
- macOS에서는 첫 캡처 시 화면 기록 권한이 필요할 수 있습니다. 권한을 부여한 뒤 앱을 다시 시작하는 것을 권장합니다.
- macOS의 스크롤 캡처에는 손쉬운 사용 권한이 필요합니다. 휠 이벤트를 감시/필터링하고 선택 영역 아래 창이 스크롤을 받도록 전달하는 데 사용합니다.
- OCR은 macOS Vision을 기반으로 합니다. 번역에는 네트워크 접근이 필요하며 기본값은 Google Translate입니다.
- Dock 아이콘 표시 옵션은 macOS에서만 사용할 수 있습니다.
- 현재 캡처 기본 경로는 주 디스플레이만 처리합니다. 다중 모니터 지원은 계속 개선 중입니다.
- 창 hover 인식은 시스템 창 열거에 의존하므로 일부 시스템 창, 오버레이, 전체 화면 앱에서는 다르게 동작할 수 있습니다.

## 설정

- 단축키: 편집을 클릭한 뒤 새 조합키를 입력하고 저장하면 즉시 적용됩니다.
- 단축키 재설정: 기본값 `Option + X` / `Alt + X`로 되돌립니다.
- Dock 아이콘: macOS에서 앱 아이콘을 Dock에 표시할지 제어합니다.
- 로그인 시 실행: 시스템 로그인 후 xshot을 자동으로 시작합니다.
- 기본 저장 위치: 스크린샷 다운로드 시 지정한 폴더에 우선 저장합니다. 설정하지 않으면 다운로드 폴더를 사용합니다.
- 보이는 워터마크: 복사, 다운로드, 화면 고정 시 사용자 지정 투명 텍스트를 추가하며 네 모서리, 가로 반복, 대각 반복을 지원합니다.
- 숨은 워터마크: 복사, 다운로드, 화면 고정 시 사용자 지정 문구를 삽입합니다. 설정 화면에서 이미지를 선택해 숨은 워터마크를 감지할 수 있고, 감지 결과가 길어 말줄임 처리된 경우에만 hover로 전체 내용을 표시합니다.
- 인터페이스 언어: 현재 간체 중국어와 English를 지원합니다.
- 권한: macOS에서 화면 기록 및 손쉬운 사용 권한 상태를 확인하고 해당 시스템 설정 패널을 바로 열 수 있습니다.

## 현재 캡처 파이프라인

- 앱 시작 시 스크린샷 WebView를 만들고 숨겨 두었다가, 캡처가 시작되면 해당 창을 재사용합니다.
- macOS 일반 캡처는 현재 시스템 `screencapture -x -R <screenshot-window-rect>`를 사용합니다. 결과는 임시 PNG로 먼저 저장한 뒤 프런트엔드 편집 레이어로 다시 읽습니다.
- Windows / Linux에서는 현재 `xcap`으로 디스플레이를 캡처하고 Rust 쪽에서 PNG를 인코딩합니다.
- macOS 스크롤 캡처는 스크린샷 창을 마우스 투과 상태로 만들고 아래 방향 휠 이벤트만 전달합니다. 각 프레임은 우선 CoreGraphics `CGWindowListCreateImage`로 스크린샷 창 아래의 선택 영역을 캡처하며, 실패 시 `screencapture -R`로 폴백합니다.
- 긴 캡처 합성은 두 프레임의 실제 세로 이동량을 기준으로 새 행만 추가합니다. 작은 이동에서는 이전 프레임을 업데이트하지 않아 반복 텍스처나 흰 배경 때문에 한 번에 너무 많이 추가되는 문제를 피합니다.
- 긴 이미지가 생성되면 자르기/편집 보기로 들어가며, 복사와 저장은 현재 자르기 영역을 내보냅니다.
- 고정 캡처는 현재 내보낸 PNG를 임시 디렉터리에 쓴 뒤, 테두리 없고 항상 위에 있으며 모든 작업 공간에서 보이는 독립 Tauri 창으로 이미지를 표시합니다.
- 워터마크는 최종 내보내기 단계에서만 적용되며 복사, 다운로드, 화면 고정에 적용됩니다. OCR, QR 인식, 번역은 워터마크 간섭을 피하기 위해 원본 선택 영역을 사용합니다.
- 숨은 워터마크의 기본 경로는 8x8 DCT 밝기 중간 주파수 계수 쌍에 차분 삽입을 수행하고, header와 본문을 중복 기록하며, 감지 시 다수결로 복원합니다. payload에는 magic, 길이, 체크섬이 포함되며 작은 이미지와 이전 내보내기 호환을 위해 기존 LSB 경로도 fallback으로 남겨 두었습니다.
- OCR은 macOS Vision `VNRecognizeTextRequest`로 텍스트를 인식하며 accurate를 우선 사용하고 실패하면 fast로 폴백합니다. QR 코드 인식은 `VNDetectBarcodesRequest`를 사용합니다.
- 번역은 Rust 백엔드가 Google Translate 인터페이스를 호출하며 시스템 프록시를 지원합니다. 번역 오버레이는 OCR block 좌표를 기준으로 편집 가능하고 되돌릴 수 있는 텍스트 주석을 만들며, 다시 클릭하면 생성된 오버레이를 제거합니다.
- 캡처 흐름에는 단계별 소요 시간 로그가 남아 단축키 트리거, 캡처 획득, 이미지 디코딩, 창 표시 등의 지연을 추적할 수 있습니다.
- 이전에 ScreenCaptureKit을 시험했지만 현재 품질과 이점이 기대에 미치지 못해 기본 경로는 안정적인 fallback 방식을 유지합니다.

## 개발

Tauri 환경 설치 참고: <https://v2.tauri.app/start/prerequisites/>

필수 조건:

- Node.js
- pnpm
- Rust
- Tauri v2 시스템 의존성

자주 쓰는 명령:

```bash
pnpm install       # 의존성 설치
pnpm dev           # Tauri 개발 환경 시작
pnpm dev:web       # Vite 프런트엔드만 시작
pnpm build:web     # 프런트엔드 빌드
pnpm build         # 데스크톱 앱 빌드
pnpm tsc           # TypeScript 검사
pnpm format        # Prettier + cargo fmt
```

프로젝트 구조:

```text
src/                    React 프런트엔드
src/windows/            스크린샷 창
src/logic/              설정, 단축키, 커서 등 프런트엔드 로직
src/logic/watermark.ts  보이는 워터마크 렌더링, 숨은 워터마크 삽입 및 감지
src-tauri/              Tauri / Rust 백엔드
src-tauri/src/lib.rs    캡처, 트레이, 클립보드, 창 명령 등록
src-tauri/src/ocr.rs    macOS Vision OCR / QR 코드 인식
src-tauri/src/translation.rs  번역 서비스
public/                 앱 이미지 리소스
```

## 현재 제한 사항

- 다중 모니터 지원은 아직 완전하지 않습니다.
- 스크롤 캡처는 현재 macOS 우선 기능이며 화면 기록 및 손쉬운 사용 권한에 의존합니다. 현재는 아래 방향 스크롤 합성만 지원합니다.
- OCR은 현재 macOS 우선 기능입니다. 번역은 네트워크와 Google Translate 사용 가능 여부에 의존합니다.
- 주석 속성 변경은 즉시 적용되지만 아직 독립 동작으로 실행 취소 스택에 포함되지 않습니다.
- 숨은 워터마크는 가벼운 추적과 감지를 위한 기능이며 DRM이나 변조 방지 수단이 아닙니다. 동일 크기 PNG/JPEG/WebP 재인코딩에는 기존 LSB보다 더 견고하지만 큰 리사이즈, 자르기, 회전, 강한 압축, 필터 처리, 2차 스크린샷 후에는 감지에 실패할 수 있습니다.
- 이미지 형식 선택, 시작 옵션, 도구 모음 사용자 지정 같은 고급 설정은 아직 제공되지 않습니다.
- 창 캡처는 후보 창 인식에 의존하므로 극히 일부 투명 창, 시스템 오버레이, 전체 화면 공간은 정확히 맞지 않을 수 있습니다.

## 로드맵

- 다중 모니터 캡처와 좌표 매핑을 개선합니다.
- 이미지 형식 및 품질 설정을 추가합니다.
- 주석 속성 변경을 더 완전한 실행 취소/다시 실행 스택에 포함합니다.
- 더 많은 주석 스타일과 도구 모음 구성을 지원합니다.
- 설치 패키지, 릴리스 흐름, 플랫폼 호환성 검증을 개선합니다.

## 기술 스택

- Tauri v2
- React 19
- TypeScript
- Vite
- Fabric.js
- lucide-react
- i18next / react-i18next
- xcap / image
- Tauri autostart / dialog / global-shortcut / clipboard-manager / opener plugins
- ai-ins Vite plugin
