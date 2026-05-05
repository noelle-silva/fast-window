package migrations

type Migration struct {
	ID          string
	FromVersion int
	ToVersion   int
	Description string
	Recovery    RecoverySpec
	Apply       func(Context) error
}

type RecoverySpec struct {
	AffectedPaths []string
	Notes         []string
}

type Context struct {
	DataDir string
	Meta    map[string]any
}

func recoverySpec(paths []string, notes ...string) RecoverySpec {
	return RecoverySpec{AffectedPaths: paths, Notes: notes}
}

func All() []Migration {
	return []Migration{
		RoleChatPackages(),
		RemoveMigratedRoleChatRootImages(),
		RefImagesToDataTree(),
		SplitMetaIndexes(),
		ChatIndexSummaries(),
	}
}
