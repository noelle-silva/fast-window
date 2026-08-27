package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
)

const (
	runModeConsole  = "console"
	runModeEmbedded = "embedded"
)

const scannerLineBufferSize = 1 << 20

type embeddedRun struct {
	id          string
	commandID   string
	repoID      string
	commandName string
	startedAt   string
	cmd         *exec.Cmd
	stopOnce    sync.Once
	jobCleanup  func()
}

type runRegistry struct {
	mu   sync.Mutex
	runs map[string]*embeddedRun
}

func newRunRegistry() *runRegistry {
	return &runRegistry{runs: make(map[string]*embeddedRun)}
}

func (reg *runRegistry) add(run *embeddedRun) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	reg.runs[run.id] = run
}

func (reg *runRegistry) get(id string) (*embeddedRun, bool) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	run, ok := reg.runs[id]
	return run, ok
}

func (reg *runRegistry) remove(id string) {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	delete(reg.runs, id)
}

func (reg *runRegistry) snapshot() []map[string]any {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	runs := make([]map[string]any, 0, len(reg.runs))
	for _, run := range reg.runs {
		runs = append(runs, map[string]any{
			"runId":       run.id,
			"commandId":   run.commandID,
			"repoId":      run.repoID,
			"commandName": run.commandName,
			"startedAt":   run.startedAt,
		})
	}
	return runs
}

// buildEmbeddedArgs 构造内嵌模式下直接启动终端的参数（脚本以文件方式传递，路径不经命令行解析）。
func buildEmbeddedArgs(shell shellDef, scriptPath, workDir string) []string {
	switch shell.id {
	case "cmd":
		return []string{"/d", "/s", "/c", scriptPath}
	case "powershell", "pwsh":
		return []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath}
	case "wsl":
		return []string{"--cd", workDir, "bash", scriptPath}
	default:
		if shell.argsTemplate != "" {
			args := make([]string, 0)
			for _, token := range splitArgsTemplate(shell.argsTemplate) {
				args = append(args, strings.ReplaceAll(token, "{command}", scriptPath))
			}
			return args
		}
		return []string{scriptPath}
	}
}

// runEmbeddedCommand 以内置模式执行命令：不弹窗口，捕获输出经事件总线实时推送。
func (svc *service) runEmbeddedCommand(id string) (map[string]any, error) {
	cmdItem, target, err := svc.locateCommand(id)
	if err != nil {
		return nil, err
	}
	if info, statErr := os.Stat(target.Path); statErr != nil || !info.IsDir() {
		return nil, fmt.Errorf("仓库目录不存在: %s", target.Path)
	}

	plan, err := svc.resolveRunPlan(cmdItem, target)
	if err != nil {
		return nil, err
	}
	if !plan.shell.available {
		return nil, fmt.Errorf("终端不可用: %s", plan.shell.name)
	}

	run := &embeddedRun{
		id:          newID("run"),
		commandID:   cmdItem.ID,
		repoID:      target.ID,
		commandName: cmdItem.Name,
		startedAt:   nowText(),
		jobCleanup:  func() {},
	}
	svc.runs.add(run)

	if err := svc.startEmbeddedProcess(cmdItem, target, plan, run); err != nil {
		svc.runs.remove(run.id)
		return nil, err
	}

	svc.emitEvent(map[string]any{
		"name":        "run.started",
		"runId":       run.id,
		"commandId":   run.commandID,
		"repoId":      run.repoID,
		"commandName": run.commandName,
		"startedAt":   run.startedAt,
	})
	return map[string]any{"started": true, "runId": run.id}, nil
}

func (svc *service) startEmbeddedProcess(cmdItem command, target repo, plan runPlan, run *embeddedRun) error {
	scriptPath, err := svc.writeScriptFile(cmdItem, plan.shell)
	if err != nil {
		return err
	}

	cmd := exec.Command(plan.shell.exePath, buildEmbeddedArgs(plan.shell, scriptPath, target.Path)...)
	cmd.Dir = target.Path
	cmd.Env = os.Environ()
	hideEmbeddedProcess(cmd)

	// 管道必须在 Start 之前建立；Start 之后再取会失败并导致输出捕获完全失效。
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("建立输出管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("建立错误输出管道失败: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("启动内置命令失败: %w", err)
	}
	run.cmd = cmd

	cleanup, err := attachJobObject(cmd)
	if err != nil {
		_ = cmd.Process.Kill()
		_ = os.Remove(scriptPath)
		return fmt.Errorf("绑定进程守护失败: %w", err)
	}
	run.jobCleanup = cleanup

	go svc.pumpOutput(run, cmd, stdout, stderr, scriptPath)
	return nil
}

// pumpOutput 逐行扫描 stdout/stderr 并推送，进程结束后推送 run.ended 并收尾。
func (svc *service) pumpOutput(run *embeddedRun, cmd *exec.Cmd, stdout, stderr io.ReadCloser, scriptPath string) {
	pipes := make(chan struct{}, 2)

	scan := func(pipe io.ReadCloser, stream string) {
		if pipe != nil {
			scanner := bufio.NewScanner(pipe)
			scanner.Buffer(make([]byte, 0, 64*1024), scannerLineBufferSize)
			for scanner.Scan() {
				svc.emitEvent(map[string]any{
					"name":   "run.output",
					"runId":  run.id,
					"text":   scanner.Text(),
					"stream": stream,
				})
			}
		}
		pipes <- struct{}{}
	}

	go scan(stdout, "stdout")
	go scan(stderr, "stderr")

	waitErr := cmd.Wait()
	<-pipes
	<-pipes

	_ = os.Remove(scriptPath)
	svc.runs.remove(run.id)
	run.jobCleanup()

	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
	}
	svc.emitEvent(map[string]any{
		"name":     "run.ended",
		"runId":    run.id,
		"exitCode": exitCode,
	})
}

// stopRun 停止一个内置运行：终结整个进程树（含脚本派生的子进程）。
func (svc *service) stopRun(id string) error {
	run, ok := svc.runs.get(id)
	if !ok {
		return fmt.Errorf("未找到运行中的命令: %s", id)
	}
	var stopErr error
	run.stopOnce.Do(func() {
		stopErr = killProcessTree(run.cmd.Process.Pid)
	})
	return stopErr
}

// locateCommand 查找命令与其所属仓库。
func (svc *service) locateCommand(id string) (command, repo, error) {
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return command{}, repo{}, err
	}
	var cmdItem command
	found := false
	for _, item := range commandsDoc.Commands {
		if item.ID == id {
			cmdItem = item
			found = true
			break
		}
	}
	if !found {
		return command{}, repo{}, fmt.Errorf("未找到命令: %s", id)
	}

	reposDoc, err := svc.loadRepos()
	if err != nil {
		return command{}, repo{}, err
	}
	for _, item := range reposDoc.Repos {
		if item.ID == cmdItem.RepoID {
			return cmdItem, item, nil
		}
	}
	return command{}, repo{}, fmt.Errorf("命令所属仓库不存在: %s", cmdItem.RepoID)
}
