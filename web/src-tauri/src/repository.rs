//! Native repository selection and inspection. No caller-supplied command or path.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
};
use tauri::{Manager, State};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{Duration, timeout},
};

#[derive(Default)]
pub struct RepositoryState(Mutex<Option<PathBuf>>);
#[derive(Serialize, Deserialize)]
struct Selection {
    repository: PathBuf,
}
#[derive(Serialize)]
pub struct Snapshot {
    root: String,
    branch: String,
    head: String,
    changes: String,
    worktrees: String,
}
const OUTPUT_LIMIT: u64 = 128 * 1024;
async fn read_bounded(stream: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    stream
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Could not read Git output.".to_owned())?;
    if bytes.len() as u64 > OUTPUT_LIMIT {
        return Err("Git output exceeds 128 KiB. Inspect this repository in your terminal.".into());
    }
    Ok(bytes)
}
async fn git_capture(
    root: &Path,
    args: &[&str],
    missing_ok: bool,
) -> Result<Option<String>, String> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args([
            "--no-pager",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|_| "Git could not start. Install Git and reopen Relay.".to_owned())?;
    let stdout = child.stdout.take().ok_or("Git output unavailable.")?;
    let stderr = child.stderr.take().ok_or("Git error output unavailable.")?;
    let result = timeout(Duration::from_secs(8), async {
        tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
            child
                .wait()
                .await
                .map_err(|_| "Git did not finish.".to_owned())
        })
    })
    .await
    .map_err(|_| {
        "Git inspection timed out. Use the terminal to inspect this repository.".to_owned()
    })??;
    if missing_ok && result.2.code() == Some(1) {
        return Ok(None);
    }
    if !result.2.success() {
        return Err(format!(
            "Git inspection failed: {}",
            String::from_utf8_lossy(&result.1).trim()
        ));
    }
    Ok(Some(
        String::from_utf8_lossy(&result.0)
            .trim_end_matches('\n')
            .to_owned(),
    ))
}
async fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    git_capture(root, args, false)
        .await?
        .ok_or_else(|| "Git output unavailable.".into())
}
async fn canonical_repository(path: &Path) -> Result<PathBuf, String> {
    let selected = path
        .canonicalize()
        .map_err(|_| "The selected folder is unavailable.".to_owned())?;
    if git(&selected, &["rev-parse", "--is-inside-work-tree"]).await? != "true" {
        return Err("Select a working Git checkout.".into());
    }
    let root = git(&selected, &["rev-parse", "--show-toplevel"]).await?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|_| "The Git root is unavailable.".to_owned())
}
async fn inspect(root: &Path) -> Result<Snapshot, String> {
    // Disable configured content filters during status inspection. Viewing status must not run a project's filter process.
    let config = git(root, &["config", "--null", "--list"]).await?;
    let mut filter_args = Vec::<String>::new();
    for entry in config.split('\0') {
        let key = entry.split('\n').next().unwrap_or("");
        if key.starts_with("filter.")
            && [".clean", ".smudge", ".process", ".required"]
                .iter()
                .any(|suffix| key.ends_with(suffix))
        {
            filter_args.push("-c".into());
            filter_args.push(format!(
                "{key}={}",
                if key.ends_with(".required") {
                    "false"
                } else {
                    ""
                }
            ));
        }
    }
    filter_args.extend(
        [
            "status",
            "--short",
            "--untracked-files=no",
            "--ignore-submodules=all",
        ]
        .map(str::to_owned),
    );
    let refs = filter_args.iter().map(String::as_str).collect::<Vec<_>>();
    let branch = git_capture(root, &["symbolic-ref", "--short", "-q", "HEAD"], true)
        .await?
        .unwrap_or_else(|| "Detached HEAD".into());
    let head = git_capture(root, &["rev-parse", "--verify", "--quiet", "HEAD"], true)
        .await?
        .unwrap_or_else(|| "No commit yet".into());
    let changes = git(root, &refs).await?;
    let worktrees = git(root, &["worktree", "list", "--porcelain"]).await?;
    Ok(Snapshot {
        root: root.to_string_lossy().into_owned(),
        branch,
        head,
        changes,
        worktrees,
    })
}
fn selected(state: &RepositoryState) -> Result<Option<PathBuf>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "Repository selection unavailable.".to_owned())?
        .clone())
}
fn selection_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "Desktop configuration is unavailable.".to_owned())?
        .join("repository.json"))
}
#[tauri::command]
pub async fn repository_status(
    app: tauri::AppHandle,
    state: State<'_, RepositoryState>,
) -> Result<Option<Snapshot>, String> {
    let path = match selected(&state)? {
        Some(path) => Some(path),
        None => {
            let file = selection_file(&app)?;
            let stored = std::fs::read(file)
                .ok()
                .filter(|b| b.len() < 16384)
                .and_then(|b| serde_json::from_slice::<Selection>(&b).ok());
            if let Some(stored) = stored {
                let root = canonical_repository(&stored.repository).await?;
                let mut current = state
                    .0
                    .lock()
                    .map_err(|_| "Repository selection unavailable.")?;
                if current.is_none() {
                    *current = Some(root);
                }
                current.clone()
            } else {
                None
            }
        }
    };
    match path {
        Some(path) => inspect(&path).await.map(Some),
        None => Ok(None),
    }
}
#[tauri::command]
pub async fn select_repository(
    app: tauri::AppHandle,
    state: State<'_, RepositoryState>,
) -> Result<Option<Snapshot>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Open a Git repository")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let root = canonical_repository(folder.path()).await?;
    let snapshot = inspect(&root).await?;
    let file = selection_file(&app)?;
    std::fs::create_dir_all(
        file.parent()
            .ok_or("Configuration directory unavailable.")?,
    )
    .map_err(|_| "Could not create desktop configuration.".to_owned())?;
    std::fs::write(
        file,
        serde_json::to_vec(&Selection {
            repository: root.clone(),
        })
        .map_err(|_| "Could not save repository selection.")?,
    )
    .map_err(|_| "Could not save repository selection.".to_owned())?;
    *state
        .0
        .lock()
        .map_err(|_| "Repository selection unavailable.")? = Some(root);
    Ok(Some(snapshot))
}
#[tauri::command]
pub async fn open_repository_terminal(state: State<'_, RepositoryState>) -> Result<(), String> {
    let path = selected(&state)?.ok_or("Open a repository first.")?;
    let root = canonical_repository(&path).await?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .args(["-a", "Terminal"])
            .arg(root)
            .status()
            .await
            .map_err(|_| "Could not open Terminal.".to_owned())?;
        if status.success() {
            Ok(())
        } else {
            Err("Terminal could not open this repository.".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = root;
        Err("Native terminal launch is currently available on macOS. Open the repository path in your terminal.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(path: &Path, args: &[&str]) {
        assert!(
            std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    #[tokio::test]
    async fn selection_inspects_real_changes_and_worktrees_without_running_filters() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo with spaces");
        std::fs::create_dir(&root).unwrap();
        run(&root, &["init", "-q"]);
        let empty = inspect(&root).await.unwrap();
        assert_eq!(empty.head, "No commit yet");
        assert_ne!(empty.branch, "Detached HEAD");
        run(&root, &["config", "user.name", "Fixture"]);
        run(&root, &["config", "user.email", "fixture@example.invalid"]);
        std::fs::write(root.join("source.txt"), "before").unwrap();
        run(&root, &["add", "source.txt"]);
        run(&root, &["commit", "-qm", "fixture"]);
        let other = dir.path().join("candidate");
        run(
            &root,
            &[
                "worktree",
                "add",
                "--detach",
                other.to_str().unwrap(),
                "HEAD",
            ],
        );
        std::fs::write(root.join("source.txt"), "after").unwrap();
        run(
            &root,
            &["config", "filter.fixture.clean", "touch FILTER_RAN"],
        );
        run(&root, &["config", "filter.fixture.required", "true"]);
        std::fs::write(root.join(".gitattributes"), "*.txt filter=fixture\n").unwrap();
        let canonical = canonical_repository(&root).await.unwrap();
        let snapshot = inspect(&canonical).await.unwrap();
        assert!(snapshot.changes.contains("source.txt"));
        assert!(snapshot.worktrees.contains("candidate"));
        assert_eq!(snapshot.head.len(), 40);
        assert!(!root.join("FILTER_RAN").exists());
        let again = inspect(&canonical).await.unwrap();
        assert_eq!(again.head, snapshot.head);
    }
    #[tokio::test]
    async fn invalid_repository_and_excess_output_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(canonical_repository(dir.path()).await.is_err());
        let bytes = vec![b'a'; OUTPUT_LIMIT as usize + 1];
        assert!(read_bounded(bytes.as_slice()).await.is_err());
        let bytes = b"bounded";
        assert_eq!(read_bounded(bytes.as_slice()).await.unwrap(), bytes);
    }
}
