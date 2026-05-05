package migrations

type Migration struct {
	ID          string
	FromVersion int
	ToVersion   int
	Description string
	Apply       func(Context) error
}

type Context struct {
	DataDir string
	Meta    map[string]any
}

func All() []Migration {
	return []Migration{
		RoleChatPackages(),
		RemoveMigratedRoleChatRootImages(),
	}
}
