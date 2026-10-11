"""Keep isolated ES-module scopes in the older inline browser fixtures."""
import re

def module_source(root, filename):
    source = (root / filename).read_text(encoding='utf-8')
    names = re.findall(r'export\s+(?:async\s+)?(?:function|const)\s+(\w+)', source)
    source = '\n'.join(line for line in source.splitlines() if not line.startswith('import '))
    source = source.replace('export ', '')
    exports = ','.join(names)
    return 'const {' + exports + '}=(()=>{' + source + '\nreturn {' + exports + '};})();'

def financial_modules(root):
    return '\n'.join(module_source(root, filename) for filename in ['cost-catalog.js', 'finance.js', 'hierarchy.js', 'cost-analytics.js'])
