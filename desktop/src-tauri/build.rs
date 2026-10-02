use std::{env,fs,path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let icons = manifest.join("icons");
    fs::create_dir_all(&icons).expect("create Tauri icons directory");
    let icon = icons.join("icon.png");
    if !icon.exists() {
        const PNG: &[u8] = &[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,32,0,0,0,32,8,6,0,0,0,115,122,122,244,0,0,0,1,115,82,71,66,0,174,206,28,233,0,0,0,15,73,68,65,84,120,156,237,193,1,1,0,0,0,128,144,254,175,238,8,0,0,0,0,73,69,78,68,174,66,96,130];
        fs::write(&icon, PNG).expect("write fallback Tauri icon");
    }
    tauri_build::build();
}
