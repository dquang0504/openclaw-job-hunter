package models

type Link struct {
	LinkedIn  string `json:"linkedin,omitempty"`
	Portfolio string `json:"portfolio,omitempty"`
}

type PersonalInformation struct {
	FullName string `json:"full_name"`
	JobTitle string `json:"job_title"`
	Location string `json:"location"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Links    Link   `json:"links"`
}

type Skills struct {
	Languages   []string `json:"languages"`
	Frontend    []string `json:"frontend"`
	Backend     []string `json:"backend"`
	Databases   []string `json:"databases"`
	DevOpsInfra []string `json:"devops_infra"`
	Security    []string `json:"security"`
}

type Experience struct {
	Role             string   `json:"role"`
	Company          string   `json:"company"`
	Location         string   `json:"location"`
	Duration         string   `json:"duration"`
	Responsibilities []string `json:"responsibilities"`
	TechStack        []string `json:"tech_stack,omitempty"`
}

type Project struct {
	Name        string   `json:"name"`
	URL         string   `json:"url,omitempty"`
	Duration    string   `json:"duration,omitempty"`
	Description string   `json:"description,omitempty"`
	Details     []string `json:"details,omitempty"`
	Status      string   `json:"status,omitempty"`
}

type Education struct {
	Degree         string `json:"degree"`
	Institution    string `json:"institution"`
	Location       string `json:"location"`
	GraduationYear string `json:"graduation_year"`
	GPA            string `json:"gpa,omitempty"`
}

type Certification struct {
	Name    string  `json:"name"`
	Band    float64 `json:"band,omitempty"`
	Details string  `json:"details,omitempty"`
	Issuer  string  `json:"issuer"`
	Year    int     `json:"year"`
}

type Resume struct {
	PersonalInformation PersonalInformation `json:"personal_information"`
	Summary             string              `json:"summary"`
	Skills              Skills              `json:"skills"`
	Experience          []Experience        `json:"experience"`
	Projects            []Project           `json:"projects"`
	Education           Education           `json:"education"`
	Certifications      []Certification     `json:"certifications"`
}
