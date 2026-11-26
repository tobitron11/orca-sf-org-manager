// `orca plugin check` renders the panel once; the worker reads the real `sf` state read-only.
import { defineCheck } from 'orca/testing'

export default defineCheck({ fresh: {} })
