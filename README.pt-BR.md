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
  <strong>Uma ferramenta de screenshot de desktop leve, residente e prática.</strong>
</p>

xshot é uma ferramenta de screenshot de desktop com captura rápida, seleção de janela/região, anotações, captura com rolagem, recorte, fixação na tela, cópia e salvamento. Ela foi pensada para uso pela bandeja e por um atalho global.

## Documentação Multilíngue

O README em chinês simplificado é a fonte de referência da documentação. Quando descrições de recursos, notas de instalação, limitações ou roadmap mudarem, atualize primeiro `README.md` e depois sincronize as versões English, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil) e Русский.

## Recursos Principais

- ✅ Suporta captura com rolagem.
- ✅ Permite fixar resultados como janelas flutuantes sempre no topo.
- ✅ Suporta OCR, reconhecimento de QR code, tradução de texto e sobreposição de tradução sobre o texto original.
- ✅ Suporta ferramentas de anotação: marcador numerado, seta, retângulo, linha, texto, caneta, borracha e mosaico por área.
- ✅ Suporta detecção de janela ao passar o cursor: mova sobre uma janela candidata e clique para selecioná-la.

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## Uso

Após iniciar, o xshot roda pela bandeja. Você pode começar uma captura assim:

- Pressione o atalho global padrão `Option + X` / `Alt + X`.

## Permissões de Plataforma e Instalação

- Se o macOS disser que o desenvolvedor não pode ser verificado, abra `Ajustes do Sistema` -> `Privacidade e Segurança` e escolha `Abrir Mesmo Assim`.
- Se o app ainda não abrir, execute `xattr -dr com.apple.quarantine /Applications/xshot.app` e tente novamente.
- No macOS, a primeira captura pode exigir permissão de gravação de tela; recomenda-se reiniciar o app depois de conceder a permissão.
- No macOS, a captura com rolagem exige permissão de acessibilidade para monitorar/filtrar eventos da roda e permitir que a janela sob a seleção receba a rolagem.
- O OCR usa macOS Vision; a tradução exige acesso à rede e usa Google Translate por padrão.
- A opção de ícone no Dock é exclusiva do macOS.
- O caminho principal de captura atual trabalha apenas com o monitor principal. O suporte a múltiplos monitores ainda está sendo melhorado.
- A detecção de janela ao passar o cursor depende da enumeração de janelas do sistema, então algumas janelas do sistema, sobreposições ou apps em tela cheia podem se comportar de forma diferente.

## Configurações

- Atalho: clique em editar, informe uma nova combinação de teclas e salve para aplicar imediatamente.
- Redefinir atalho: restaura `Option + X` / `Alt + X`.
- Ícone no Dock: no macOS, controla se o ícone do app aparece no Dock.
- Iniciar ao entrar: inicia o xshot automaticamente após o login.
- Local padrão para salvar: screenshots baixadas são salvas primeiro na pasta definida; se não houver uma, usa Downloads.
- Idioma da interface: atualmente suporta chinês simplificado e English.
- Permissões: no macOS, mostra o status de gravação de tela e acessibilidade, e abre diretamente o painel correspondente dos Ajustes do Sistema.

## Pipeline de Captura Atual

- Ao iniciar, o app cria e oculta o WebView de screenshot, reutilizando essa janela quando uma captura começa.
- No macOS, a captura comum usa atualmente o `screencapture -x -R <screenshot-window-rect>` do sistema; o resultado é gravado primeiro em um PNG temporário e depois carregado na camada de edição do frontend.
- No Windows / Linux, o caminho atual captura a tela por `xcap` e codifica PNG no lado Rust.
- No macOS, a captura com rolagem torna a janela de screenshot transparente ao mouse e repassa apenas eventos de roda para baixo. Cada quadro tenta primeiro capturar o conteúdo sob a janela de screenshot com CoreGraphics `CGWindowListCreateImage`; se falhar, recorre a `screencapture -R`.
- A montagem da captura longa adiciona apenas novas linhas com base no deslocamento vertical real entre dois quadros. Pequenos deslocamentos não atualizam o quadro anterior, evitando adição excessiva em texturas repetidas ou fundos brancos.
- Depois de gerada, a captura longa entra na visão de recorte/edição; copiar e salvar exportam a área de recorte atual.
- Fixar uma captura grava o PNG exportado em um diretório temporário e cria uma janela Tauri independente, sem borda, sempre no topo e visível em todos os espaços para exibir a imagem.
- O OCR usa `VNRecognizeTextRequest` do macOS Vision, priorizando accurate e recorrendo a fast se falhar; o reconhecimento de QR usa `VNDetectBarcodesRequest`.
- A tradução é feita pelo backend Rust via Google Translate e suporta proxy do sistema. A sobreposição de tradução cria anotações de texto editáveis e reversíveis a partir das coordenadas OCR block; clicar novamente remove a sobreposição gerada.
- O fluxo de captura mantém logs de tempo por etapa para localizar latência no atalho, captura de tela, decodificação de imagem e apresentação da janela.
- ScreenCaptureKit foi testado anteriormente, mas a qualidade e o ganho não atingiram o esperado; por isso o caminho principal mantém o fallback estável.

## Desenvolvimento

Pré-requisitos do Tauri: <https://v2.tauri.app/start/prerequisites/>

Requisitos:

- Node.js
- pnpm
- Rust
- Dependências de sistema do Tauri v2

Comandos úteis:

```bash
pnpm install       # Instalar dependências
pnpm dev           # Iniciar ambiente de desenvolvimento Tauri
pnpm dev:web       # Iniciar apenas o frontend Vite
pnpm build:web     # Construir frontend
pnpm build         # Construir app desktop
pnpm tsc           # Verificação TypeScript
pnpm format        # Prettier + cargo fmt
```

Estrutura do projeto:

```text
src/                    Frontend React
src/windows/            Janela de screenshot
src/logic/              Configurações, atalhos, cursor e outras lógicas frontend
src-tauri/              Backend Tauri / Rust
src-tauri/src/lib.rs    Captura, bandeja, área de transferência, registro de comandos de janela
src-tauri/src/ocr.rs    OCR macOS Vision / reconhecimento QR
src-tauri/src/translation.rs  Serviço de tradução
public/                 Recursos de imagem do app
```

## Limitações Atuais

- O suporte a múltiplos monitores ainda está incompleto.
- A captura com rolagem é atualmente uma capacidade focada em macOS e depende de permissões de gravação de tela e acessibilidade; no momento só suporta montagem rolando para baixo.
- O OCR atualmente é focado em macOS; a tradução depende de rede e da disponibilidade do Google Translate.
- Edições de propriedades de anotação são aplicadas imediatamente, mas ainda não entram como ações independentes na pilha de desfazer.
- Configurações avançadas como seleção de formato de imagem, parâmetros de inicialização e personalização da barra de ferramentas ainda não estão expostas.
- A captura de janela depende da detecção de janelas candidatas; algumas poucas janelas transparentes, sobreposições do sistema ou espaços em tela cheia podem não ser atingidos com precisão.

## Roadmap

- Completar captura multimonitor e mapeamento de coordenadas.
- Adicionar configurações de formato e qualidade de imagem.
- Colocar mudanças de propriedades de anotação em uma pilha de desfazer/refazer mais completa.
- Suportar mais estilos de anotação e configuração da barra de ferramentas.
- Melhorar pacotes de instalação, fluxo de release e validação de compatibilidade de plataforma.

## Stack Técnica

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
