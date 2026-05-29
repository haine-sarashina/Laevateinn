fn main() {
    // Load environment variables from .env file (if present) in the current directory
    let _ = dotenv::dotenv();
    laevateinn_lib::run();
}
