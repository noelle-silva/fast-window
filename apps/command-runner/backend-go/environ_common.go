package main

// normalizeEnv 将环境键值表转为稳定的键值对切片（键统一大写，按键排序）。
func normalizeEnv(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sortStrings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+env[key])
	}
	return result
}

func sortStrings(values []string) {
	for idx := 1; idx < len(values); idx++ {
		for jdx := idx; jdx > 0 && values[jdx-1] > values[jdx]; jdx-- {
			values[jdx-1], values[jdx] = values[jdx], values[jdx-1]
		}
	}
}
