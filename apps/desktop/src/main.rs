use captions::CaptionDocument;
use gpui::{
    div, prelude::*, px, rgb, size, App, Application, Bounds, Context, SharedString, Window,
    WindowBounds, WindowOptions,
};

struct AppWindow {
    title: SharedString,
    /// Rust-owned canonical caption state. GPUI only renders/edits this model.
    caption_document: Option<CaptionDocument>,
}

impl Render for AppWindow {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let _caption_page_count = self
            .caption_document
            .as_ref()
            .map_or(0, |document| document.pages.len());
        div()
            .size_full()
            .bg(rgb(0x0f0f0f))
            .flex()
            .justify_center()
            .items_center()
            .text_xl()
            .text_color(rgb(0xffffff))
            .child(self.title.clone())
    }
}

fn main() {
    Application::new().run(|cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1280.), px(720.)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| {
                cx.new(|_| AppWindow {
                    title: "OpenCut".into(),
                    caption_document: None,
                })
            },
        )
        .unwrap();
        cx.activate(true);
    });
}
