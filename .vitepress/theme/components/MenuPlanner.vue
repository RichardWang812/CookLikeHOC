<template>
  <div class="menu-planner">
    <section class="planner-header">
      <div class="people-input">
        <label for="people-count">就餐人数</label>
        <input
          id="people-count"
          type="number"
          min="1"
          max="10"
          v-model.number="peopleCount"
        />
        <span class="people-hint">默认 2 人，可根据家庭规模调整</span>
      </div>
      <button class="share" type="button" @click="sharePlanner">
        分享给朋友
      </button>
    </section>

    <section class="calendar-wrapper">
      <div class="calendar-header">
        <button type="button" @click="goToPrevMonth">‹</button>
        <div>
          {{ currentYear }} 年 {{ currentMonth + 1 }} 月
        </div>
        <button type="button" @click="goToNextMonth">›</button>
      </div>
      <div class="weekday-row">
        <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
      </div>
      <div class="calendar-grid">
        <button
          v-for="day in calendarDays"
          :key="day.dateKey"
          type="button"
          class="calendar-day"
          :class="{
            'other-month': !day.isCurrentMonth,
            today: day.isToday,
            selected: day.dateKey === selectedDate,
            holiday: Boolean(day.holiday)
          }"
          @click="handleDayClick(day)"
        >
          <span class="date-number">{{ day.dayNumber }}</span>
          <small v-if="day.holiday" class="holiday-name">{{ day.holiday.name }}</small>
        </button>
      </div>
      <div class="legend">
        <span class="legend-item today">今天</span>
        <span class="legend-item holiday">节日</span>
        <span class="legend-item selected">当前菜单</span>
      </div>
    </section>

    <transition name="fade">
      <section v-if="activeMenu" class="daily-menu">
        <header class="menu-header">
          <div>
            {{ formatDisplayDate(activeMenu.dateKey) }} · 适合 {{ peopleCount }} 人
            <span v-if="activeMenu.holiday" class="holiday-badge">{{ activeMenu.holiday.name }}推荐</span>
          </div>
          <button v-if="!activeMenu.holiday" type="button" @click="regenerateDay">重新随机</button>
        </header>
        <div class="meals">
          <article
            v-for="meal in activeMenu.meals"
            :key="meal.type"
            class="meal-card"
          >
            <header @click="toggleMeal(meal.type)" class="meal-header">
              <h3>{{ mealLabels[meal.type] }}</h3>
              <span>{{ meal.expanded ? '收起' : '展开' }}</span>
            </header>
            <ul class="dish-list" v-if="meal.expanded">
              <li v-for="(dish, index) in meal.dishes" :key="dish.id" class="dish-item">
                <div class="dish-main">
                  <a class="dish-link" :href="dish.link">
                    <h4>{{ dish.name }}</h4>
                    <span class="dish-subtext">查看菜谱</span>
                  </a>
                  <button
                    type="button"
                    @click.stop="swapDish(meal.type, index)"
                    :disabled="dish.locked"
                    class="swap"
                  >
                    {{ dish.locked ? '节日固定' : '更换' }}
                  </button>
                </div>
                <p v-if="dish.note" class="dish-note">{{ dish.note }}</p>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

type MealType = 'breakfast' | 'lunch' | 'dinner'

type RecipeCategory =
  | 'breakfast'
  | 'main'
  | 'staple'
  | 'soup'
  | 'side'
  | 'drink'

type ParsedRecipe = {
  id: string
  name: string
  directory: string
  category: RecipeCategory
  link: string
  steps: string[]
  ingredients: string[]
  note?: string
}

type DishInstance = ParsedRecipe & { locked?: boolean }

type MealPlan = {
  type: MealType
  dishes: DishInstance[]
  expanded: boolean
}

type HolidayInfo = {
  name: string
  menu: Record<MealType, string[]>
}

type HolidayDay = HolidayInfo & { key: string }

type PlannedDay = {
  dateKey: string
  meals: MealPlan[]
  holiday?: HolidayInfo
}

type CalendarDay = {
  dateKey: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  holiday?: HolidayInfo
}

const mealLabels: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

const dirToCategory: Record<string, RecipeCategory> = {
  早餐: 'breakfast',
  主食: 'staple',
  炒菜: 'main',
  炖菜: 'main',
  汤: 'soup',
  煮锅: 'main',
  砂锅菜: 'main',
  蒸菜: 'main',
  炸品: 'side',
  凉拌: 'side',
  卤菜: 'side',
  烤类: 'side',
  饮品: 'drink',
  烫菜: 'side',
}

const recipeModules = import.meta.glob('../../../{早餐,主食,炒菜,汤,炖菜,煮锅,砂锅菜,蒸菜,炸品,凉拌,卤菜,烤类,饮品,烫菜}/*.md', {
  as: 'raw',
  eager: true,
})

const recipePool: Record<RecipeCategory, ParsedRecipe[]> = {
  breakfast: [],
  main: [],
  staple: [],
  soup: [],
  side: [],
  drink: [],
}

const recipeMap = new Map<string, ParsedRecipe>()

const parseRecipe = (id: string, directory: string, fileName: string, raw: string): ParsedRecipe | null => {
  const lines = raw.split(/\r?\n/)
  const titleLine = lines.find((line) => line.trim().startsWith('# '))
  const name = titleLine ? titleLine.replace(/^#\s*/, '').trim() : id

  const noteLine = lines.find((line) => line.trim().startsWith('> '))
  const note = noteLine ? noteLine.replace(/^>\s*/, '').trim() : undefined

  const link = '/' + [directory, fileName.replace(/\.md$/i, '')]
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')

  const sectionContent: Record<string, string[]> = {}
  let currentSection: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('>')) continue

    if (line.startsWith('## ')) {
      const sectionName = line.replace(/^##\s*/, '').trim().replace(/[:：]$/, '')
      currentSection = sectionName
      sectionContent[currentSection] = []
      continue
    }

    if (currentSection) {
      sectionContent[currentSection].push(line)
    }
  }

  const sanitizeLine = (value: string): string => {
    return value
      .replace(/^[-*•·▪●‣▹▸◦]+\s*/, '')
      .replace(/^\d+[.)、]?\s*/, '')
      .replace(/^[A-Za-z][.)、]\s*/, '')
      .replace(/^[①-⑳]\s*/, '')
      .replace(/^[一二三四五六七八九十]+、\s*/, '')
      .replace(/^（\d+）\s*/, '')
      .replace(/^（[一二三四五六七八九十]+）\s*/, '')
      .replace(/^\(\d+\)\s*/, '')
      .trim()
  }

  const extractList = (sectionNames: string[]): string[] => {
    for (const name of sectionNames) {
      const section = sectionContent[name]
      if (!section?.length) continue
      const items = section
        .map((line) => sanitizeLine(line))
        .filter(Boolean)
      if (items.length) return items
    }
    return []
  }

  const ingredients = extractList(['原料', '主要原料', '食材', '配料', '用料', '材料'])
  const steps = extractList(['步骤', '制作方法', '做法', '烹饪方法', '制作步骤', '烹饪步骤'])

  return {
    id,
    name,
    directory,
    category: dirToCategory[directory],
    link,
    steps,
    ingredients,
    note,
  }
}

for (const [path, raw] of Object.entries(recipeModules)) {
  const segments = path.split('/')
  const fileName = segments.at(-1) ?? ''
  const directory = segments.at(-2) ?? ''
  if (fileName.toLowerCase() === 'readme.md') continue
  const id = `${directory}/${fileName}`
  const recipe = parseRecipe(id, directory, fileName, raw as string)
  if (!recipe) continue
  const category = recipe.category
  if (!category) continue
  recipePool[category].push(recipe)
  recipeMap.set(recipe.name, recipe)
}

const holidayPresets: HolidayDay[] = [
  {
    key: '2024-01-01',
    name: '元旦',
    menu: {
      breakfast: ['热奶茶', '手工烧麦'],
      lunch: ['红烧鱼块', '杂粮饭', '老鸡汤'],
      dinner: ['香辣牛肉面', '西芹花生米', '鸡笼香柠檬茶'],
    },
  },
  {
    key: '2024-02-10',
    name: '春节',
    menu: {
      breakfast: ['鸡汁汤包', '茶叶蛋'],
      lunch: ['砂锅盐焗鸡', '米饭', '竹荪鹿茸菇鸡汤'],
      dinner: ['笋子烧肉', '酸辣土豆丝', '鸡笼香柠檬茶'],
    },
  },
  {
    key: '2024-02-24',
    name: '元宵节',
    menu: {
      breakfast: ['赤豆糊元宵', '热奶茶'],
      lunch: ['宫保鸡丁', '米饭', '老鸡汤'],
      dinner: ['麻婆豆腐', '青椒炒鸡蛋', '苹果山楂红茶'],
    },
  },
  {
    key: '2024-04-04',
    name: '清明节',
    menu: {
      breakfast: ['荠菜鲜肉蒸饺', '现熬豆粥'],
      lunch: ['蒜泥菠菜', '小炒花菜', '米饭'],
      dinner: ['砂锅蒜蓉粉丝虾', '鸡汤娃娃菜', '苹果山楂红茶'],
    },
  },
  {
    key: '2024-05-01',
    name: '劳动节',
    menu: {
      breakfast: ['香酥牛肉饼', '现炸大油条'],
      lunch: ['鱼香肉丝', '杂粮饭', '竹荪鹿茸菇鸡汤'],
      dinner: ['贵州风味辣子鸡', '清炒西兰花', '热奶茶'],
    },
  },
  {
    key: '2024-06-10',
    name: '端午节',
    menu: {
      breakfast: ['饭团', '热奶茶'],
      lunch: ['麻婆豆腐', '米饭', '肥西老母鸡汤'],
      dinner: ['小炒黄牛肉', '口水鸡', '苹果山楂红茶'],
    },
  },
  {
    key: '2024-09-17',
    name: '中秋节',
    menu: {
      breakfast: ['酥皮萝卜丝馅饼', '热奶茶'],
      lunch: ['糖醋排骨', '米饭', '竹荪鹿茸菇鸡汤'],
      dinner: ['菠萝咕咾肉', '蒜泥菠菜', '鸡笼香柠檬茶'],
    },
  },
  {
    key: '2024-10-01',
    name: '国庆节',
    menu: {
      breakfast: ['包子', '鸡汁汤包'],
      lunch: ['砂锅原味鸡汤米线'],
      dinner: ['红烧茄子', '米饭', '老鸡汤'],
    },
  },
]

const holidayMap = holidayPresets.reduce<Record<string, HolidayInfo>>((acc, holiday) => {
  acc[holiday.key] = { name: holiday.name, menu: holiday.menu }
  return acc
}, {})

const today = new Date()
const current = reactive({
  year: today.getFullYear(),
  month: today.getMonth(),
})

const selectedDate = ref<string>('')
const menuByDate = reactive<Record<string, PlannedDay>>({})
const peopleCount = ref<number>(2)

const currentYear = computed(() => current.year)
const currentMonth = computed(() => current.month)

const startOfMonth = computed(() => new Date(current.year, current.month, 1))
const calendarDays = computed<CalendarDay[]>(() => {
  const days: CalendarDay[] = []
  const firstDay = startOfMonth.value
  const firstWeekday = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(current.year, current.month + 1, 0).getDate()

  for (let i = firstWeekday - 1; i >= 0; i -= 1) {
    const date = new Date(current.year, current.month, -i)
    days.push(buildCalendarDay(date, false))
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(current.year, current.month, day)
    days.push(buildCalendarDay(date, true))
  }

  while (days.length % 7 !== 0) {
    const last = days[days.length - 1]
    const [y, m, d] = last.dateKey.split('-').map(Number)
    const nextDate = new Date(y, m - 1, d + 1)
    days.push(buildCalendarDay(nextDate, false))
  }

  return days
})

function buildCalendarDay(date: Date, isCurrentMonth: boolean): CalendarDay {
  const dateKey = formatDateKey(date)
  return {
    dateKey,
    dayNumber: date.getDate(),
    isCurrentMonth,
    isToday: isSameDate(date, today),
    holiday: holidayMap[dateKey],
  }
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function goToPrevMonth(): void {
  if (current.month === 0) {
    current.year -= 1
    current.month = 11
  } else {
    current.month -= 1
  }
}

function goToNextMonth(): void {
  if (current.month === 11) {
    current.year += 1
    current.month = 0
  } else {
    current.month += 1
  }
}

function handleDayClick(day: CalendarDay): void {
  selectedDate.value = day.dateKey
  generateMenuForDay(day.dateKey)
}

function generateMenuForDay(dateKey: string): void {
  const holiday = holidayMap[dateKey]
  const meals: MealPlan[] = holiday ? buildHolidayMenu(holiday) : buildRandomMenu()
  menuByDate[dateKey] = {
    dateKey,
    holiday,
    meals,
  }
}

function buildHolidayMenu(holiday: HolidayInfo): MealPlan[] {
  const meals: MealPlan[] = []
  (['breakfast', 'lunch', 'dinner'] as MealType[]).forEach((mealType) => {
    const names = holiday.menu[mealType]
    if (!names) return
    const dishes: DishInstance[] = names
      .map((name) => {
        const recipe = recipeMap.get(name)
        if (!recipe) return null
        return { ...recipe, locked: true }
      })
      .filter((dish): dish is DishInstance => Boolean(dish))
    if (dishes.length) {
      meals.push({ type: mealType, dishes, expanded: true })
    }
  })
  return meals
}

function adjustCount(category: RecipeCategory, base: number): number {
  const poolSize = recipePool[category]?.length ?? 0
  if (poolSize === 0) return 0
  const people = peopleCount.value
  let extra = 0
  if (category === 'breakfast') {
    extra = people >= 4 ? 1 : 0
  } else if (category === 'main') {
    extra = Math.floor(Math.max(people - 2, 0) / 2)
  } else if (category === 'side') {
    extra = people >= 4 ? 1 : 0
  } else if (category === 'staple') {
    extra = people >= 5 ? 1 : 0
  } else if (category === 'soup') {
    extra = people >= 5 ? 1 : 0
  }
  const baseCount = Math.min(base, poolSize)
  const total = Math.min(base + extra, poolSize)
  if (total === 0) return 0
  return Math.max(baseCount > 0 ? 1 : 0, total)
}

function buildRandomMenu(): MealPlan[] {
  return (
    [
      { type: 'breakfast', config: [{ category: 'breakfast', count: 2 }] },
      {
        type: 'lunch',
        config: [
          { category: 'main', count: 1 },
          { category: 'staple', count: 1 },
          { category: 'soup', count: 1 },
          { category: 'side', count: 1 },
        ],
      },
      {
        type: 'dinner',
        config: [
          { category: 'main', count: 1 },
          { category: 'staple', count: 1 },
          { category: 'side', count: 1 },
          { category: 'drink', count: 1 },
        ],
      },
    ] as const
  ).map((entry) => {
    const dishList: DishInstance[] = []
    entry.config.forEach(({ category, count }) => {
      const pool = recipePool[category]
      const finalCount = adjustCount(category, count)
      if (finalCount <= 0) return
      const picks = takeRandom(pool, finalCount, dishList.map((dish) => dish.id))
      dishList.push(...picks)
    })
    return { type: entry.type, dishes: dishList, expanded: false }
  })
}

function takeRandom(source: ParsedRecipe[], count: number, excludeIds: string[] = []): DishInstance[] {
  const available = source.filter((item) => !excludeIds.includes(item.id))
  if (!available.length) return []
  const picks: DishInstance[] = []
  const max = Math.min(count, available.length)
  const usedIndexes = new Set<number>()

  while (picks.length < max) {
    const index = Math.floor(Math.random() * available.length)
    if (usedIndexes.has(index)) continue
    usedIndexes.add(index)
    picks.push({ ...available[index] })
  }

  return picks
}

const activeMenu = computed(() => {
  if (!selectedDate.value) return null
  return menuByDate[selectedDate.value] ?? null
})

watch(peopleCount, () => {
  const dateKey = selectedDate.value
  if (!dateKey) return
  const record = menuByDate[dateKey]
  if (!record || record.holiday) return
  generateMenuForDay(dateKey)
})

function toggleMeal(mealType: MealType): void {
  const menu = activeMenu.value
  if (!menu) return
  const meal = menu.meals.find((item) => item.type === mealType)
  if (meal) meal.expanded = !meal.expanded
}


function swapDish(mealType: MealType, index: number): void {
  const dateKey = selectedDate.value
  if (!dateKey) return
  const dailyMenu = menuByDate[dateKey]
  if (!dailyMenu) return

  const meal = dailyMenu.meals.find((item) => item.type === mealType)
  if (!meal) return

  const target = meal.dishes[index]
  if (!target || target.locked) return

  const pool = recipePool[target.category]
  const excludeIds = meal.dishes.map((dish) => dish.id)
  const replacement = takeRandom(pool, 1, excludeIds)[0]
  if (!replacement) return
  const nextDish: DishInstance = { ...replacement, locked: false }
  meal.dishes.splice(index, 1, nextDish)
}

function regenerateDay(): void {
  const dateKey = selectedDate.value
  if (!dateKey) return
  generateMenuForDay(dateKey)
}

function formatDisplayDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return `${year} 年 ${month} 月 ${day} 日`
}

async function sharePlanner(): Promise<void> {
  const url = window.location.href
  const title = '每日菜谱日历'
  const text = '分享到微信，邀请家人一起挑选今天吃什么。'
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return
    } catch (error) {
      console.warn('Share cancelled', error)
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    window.alert('链接已复制，快去微信分享吧！')
  } catch (error) {
    console.warn('Copy failed', error)
  }
}

if (!selectedDate.value) {
  const todayKey = formatDateKey(today)
  const todayHoliday = holidayMap[todayKey]
  const initialDate = todayHoliday ? todayKey : todayKey
  selectedDate.value = initialDate
  generateMenuForDay(initialDate)
}
</script>

<style scoped>
.menu-planner {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  color: #0f3015;
}

.planner-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  background: #f4f8f5;
  border-radius: 0.75rem;
  border: 1px solid rgba(8, 102, 57, 0.2);
}

.people-input {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: #044c26;
}

.people-input input {
  width: 6rem;
  padding: 0.4rem 0.6rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(8, 102, 57, 0.4);
  font-size: 1rem;
}

.people-hint {
  font-size: 0.8rem;
  color: rgba(4, 76, 38, 0.7);
}

.share {
  background: #087337;
  color: #fff;
  border: none;
  padding: 0.6rem 1.4rem;
  border-radius: 999px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.share:hover {
  background: #0a8a42;
}

.calendar-wrapper {
  background: #fff;
  border-radius: 1rem;
  padding: 1rem;
  border: 1px solid rgba(8, 102, 57, 0.2);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 64, 32, 0.05);
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #043b1f;
  margin-bottom: 0.75rem;
}

.calendar-header button {
  background: transparent;
  border: none;
  font-size: 1.5rem;
  color: #087337;
  cursor: pointer;
}

.weekday-row,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.5rem;
}

.weekday-row span {
  text-align: center;
  font-weight: 600;
  color: rgba(4, 76, 38, 0.7);
}

.calendar-day {
  min-height: 4.2rem;
  background: #f7faf8;
  border-radius: 0.75rem;
  border: 1px solid transparent;
  color: #043b1f;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  cursor: pointer;
  transition: border 0.2s ease, transform 0.1s ease;
}

.calendar-day .date-number {
  font-weight: 600;
}

.calendar-day .holiday-name {
  background: rgba(8, 115, 55, 0.1);
  color: #087337;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.75rem;
}

.calendar-day:hover {
  border-color: rgba(8, 115, 55, 0.4);
  transform: translateY(-1px);
}

.calendar-day.other-month {
  color: rgba(4, 76, 38, 0.4);
  background: #f0f4f1;
}

.calendar-day.today {
  border-color: #087337;
}

.calendar-day.selected {
  background: #087337;
  color: #fff;
}

.calendar-day.holiday {
  border-color: rgba(204, 153, 0, 0.5);
  background: #fff7e0;
}

.calendar-day.selected .holiday-name {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.legend {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(8, 102, 57, 0.25);
}

.legend-item.today {
  background: rgba(8, 115, 55, 0.1);
}

.legend-item.holiday {
  background: #fff7e0;
}

.legend-item.selected {
  background: #087337;
  color: #fff;
}

.daily-menu {
  background: #fff;
  border-radius: 1rem;
  padding: 1.25rem;
  border: 1px solid rgba(8, 102, 57, 0.2);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 64, 32, 0.05);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-weight: 600;
  color: #043b1f;
}

.menu-header button {
  background: #fff;
  border: 1px solid rgba(8, 102, 57, 0.5);
  border-radius: 999px;
  padding: 0.4rem 1rem;
  color: #087337;
  cursor: pointer;
}

.holiday-badge {
  background: #ffd965;
  color: #6b4d00;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.85rem;
  margin-left: 0.5rem;
}

.meals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}

.meal-card {
  border: 1px solid rgba(8, 102, 57, 0.2);
  border-radius: 0.75rem;
  background: #f7faf8;
  display: flex;
  flex-direction: column;
}

.meal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  color: #043b1f;
}

.meal-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.dish-list {
  list-style: none;
  padding: 0 1rem 1rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dish-item {
  background: #fff;
  border-radius: 0.75rem;
  padding: 0.75rem;
  border: 1px solid rgba(8, 102, 57, 0.15);
}

.dish-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.dish-link {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  color: inherit;
  text-decoration: none;
}

.dish-link:focus-visible {
  outline: 2px solid rgba(8, 115, 55, 0.4);
  border-radius: 0.5rem;
}

.dish-main h4 {
  margin: 0;
  font-size: 1rem;
  color: #043b1f;
}

.dish-subtext {
  font-size: 0.85rem;
  color: rgba(4, 76, 38, 0.7);
}

.dish-link:hover h4,
.dish-link:hover .dish-subtext {
  color: #087337;
}

.swap {
  border: 1px solid rgba(8, 102, 57, 0.4);
  background: transparent;
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
  color: #087337;
  font-size: 0.9rem;
}

.swap:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dish-note {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  color: rgba(4, 76, 38, 0.7);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .calendar-grid {
    gap: 0.35rem;
  }

  .calendar-day {
    min-height: 3.6rem;
    border-radius: 0.6rem;
  }

  .meals {
    grid-template-columns: 1fr;
  }
}
</style>
