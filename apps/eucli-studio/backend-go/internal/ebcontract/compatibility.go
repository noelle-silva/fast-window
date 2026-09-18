package ebcontract

import (
	"fmt"
	"strconv"
	"strings"
)

// semanticVersion 是主.次.补( [.开发序号] )版本。
type semanticVersion struct {
	major    int
	minor    int
	patch    int
	build    int
	hasBuild bool
}

func ValidateVersion(value string) error {
	_, err := parseVersion(value)
	return err
}

func ValidateEucliBoxCompatibility(compatibility EucliBoxCompatibility) error {
	minimum, err := parseVersion(compatibility.MinimumVersion)
	if err != nil {
		return fmt.Errorf("最低适用版本无效：%w", err)
	}
	maximum, err := parseVersion(compatibility.MaximumVersionExclusive)
	if err != nil {
		return fmt.Errorf("最高适用边界无效：%w", err)
	}
	if compare(minimum, maximum) >= 0 {
		return fmt.Errorf("最低适用版本必须低于最高适用边界")
	}
	return nil
}

func parseVersion(value string) (semanticVersion, error) {
	trimmed := strings.TrimSpace(value)
	parts := strings.Split(trimmed, ".")
	if len(parts) != 3 && len(parts) != 4 {
		return semanticVersion{}, fmt.Errorf("版本必须使用三段正式版本或四段开发版本，例如 0.1.0 或 0.1.0.1")
	}
	ints := make([]int, len(parts))
	for index, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return semanticVersion{}, fmt.Errorf("版本必须使用三段正式版本或四段开发版本，例如 0.1.0 或 0.1.0.1")
		}
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return semanticVersion{}, fmt.Errorf("版本必须使用三段正式版本或四段开发版本，例如 0.1.0 或 0.1.0.1")
		}
		ints[index] = parsed
	}
	return semanticVersion{
		major:    ints[0],
		minor:    ints[1],
		patch:    ints[2],
		build:    optionalInt(ints, 3),
		hasBuild: len(parts) == 4,
	}, nil
}

func optionalInt(values []int, index int) int {
	if index >= len(values) {
		return 0
	}
	return values[index]
}

func compare(left semanticVersion, right semanticVersion) int {
	if left.major != right.major {
		if left.major < right.major {
			return -1
		}
		return 1
	}
	if left.minor != right.minor {
		if left.minor < right.minor {
			return -1
		}
		return 1
	}
	if left.patch < right.patch {
		return -1
	}
	if left.patch > right.patch {
		return 1
	}
	if left.build < right.build {
		return -1
	}
	if left.build > right.build {
		return 1
	}
	return 0
}
