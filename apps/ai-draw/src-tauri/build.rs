fn main() {
    if cfg!(debug_assertions) {
        let config = std::fs::read_to_string("tauri.conf.dev.json")
            .expect("failed to read tauri.conf.dev.json");
        let inline_config = config.replace(['\r', '\n'], "");
        std::env::set_var("TAURI_CONFIG", &inline_config);
        println!("cargo:rustc-env=TAURI_CONFIG={inline_config}");
    }
    tauri_build::build()
}
