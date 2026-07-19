//! Canonical caption timing domain.
//!
//! All internal time values are integer microseconds relative to the complete
//! project timeline. Front ends may convert at their boundaries, but must not
//! synthesize independent word timings.

mod active;
mod audio;
mod config;
mod edit;
mod export;
mod model;
mod normalize;
mod pages;
mod timeline;
mod vad;
mod validation;

pub use active::*;
pub use audio::*;
pub use config::*;
pub use edit::*;
pub use export::*;
pub use model::*;
pub use normalize::*;
pub use pages::*;
pub use timeline::*;
pub use vad::*;
pub use validation::*;
